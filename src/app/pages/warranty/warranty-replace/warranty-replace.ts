import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService, WarrantyReceipt, WarrantyReplacement } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { localizeAddress } from '../../../utils/bd-geo';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { DmyDateDirective } from '../../../directives/dmy-date.directive';
import { WarrantyClaim } from '../../../components/warranty-claim/warranty-claim';
import { dmyFromIso, localDateIso } from '../../../utils/local-date';
import { isWarrantyCancelled, isWarrantyCompleted, isoDay } from '../../../utils/warranty';

type ReplacementStage = 'completed' | 'pending' | 'cancelled';
// Older vouchers posted stock regardless of their customizable status label.
type StagedReplacement = WarrantyReplacement & { stage?: ReplacementStage };
type ReplacementPayload = Omit<WarrantyReplacement, 'id' | 'claimNo' | 'createdAt' | 'updatedAt' | 'receiptPrevStatus'> & { stage: ReplacementStage };

interface ReplacementForm {
  receiptId: number | null;
  receiptClaimNo: string;
  date: string;
  customerName: string;
  phone: string;
  productId: number | null;
  productName: string;
  serialNumber: string;
  quantity: number | null;
  unit: string;
  source: 'warranty' | 'main';
  stockInQty: number | null;
  supplierId: number | null;
  supplierName: string;
  supplierRef: string;
  disposeReceived: boolean;
  disposition: string;
  cost: number | null;
  stage: ReplacementStage;
  status: string;
  notes: string;
  handledBy: string;
}

@Component({
  selector: 'app-warranty-replace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, RouterLink, TablePagination, DmyDateDirective, WarrantyClaim],
  template: `
    <div class="no-print space-y-4 text-xs text-slate-800 dark:text-slate-200">
      @if (isFormView) {
        <header class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
          <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
          <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

          <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-3">
              <a routerLink="/warranty/replace" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 transition hover:bg-white/25" [title]="prefs.txt('তালিকায় ফিরুন', 'Back to list')">
                <mat-icon class="text-lg">arrow_back</mat-icon>
              </a>
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                  {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                  <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                  {{ prefs.txt('পরিবর্তন', 'Replacement') }}
                </p>
                <h1 class="truncate text-xl font-bold leading-tight">{{ editId() !== null ? prefs.txt('পরিবর্তন এডিট করুন', 'Edit Replacement') : prefs.txt('নতুন ওয়ারেন্টি পরিবর্তন', 'New Warranty Replacement') }}</h1>
                <p class="flex items-center gap-1.5 truncate text-[11px] text-teal-50/85">
                  {{ prefs.txt('ক্লেইম নম্বর', 'Claim no') }}
                  <span class="rounded-md bg-white/15 px-1.5 py-0.5 font-mono font-bold ring-1 ring-white/20">{{ claimNo() }}</span>
                  @if (isDirty()) { <span class="rounded-md bg-amber-400/25 px-1.5 py-0.5 font-bold text-amber-50 ring-1 ring-amber-200/40">{{ prefs.txt('সেভ হয়নি', 'Unsaved') }}</span> }
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <a routerLink="/warranty/replace" class="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20">{{ prefs.txt('বাতিল', 'Cancel') }}</a>
              <button type="button" (click)="save()" [disabled]="busy()" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50 disabled:opacity-60 cursor-pointer"><mat-icon class="text-xs">save</mat-icon>{{ editId() !== null ? prefs.txt('আপডেট', 'Update') : prefs.txt('সেভ করুন', 'Save') }}</button>
            </div>
          </div>
        </header>

      <section class="panel overflow-hidden">
        <fieldset [disabled]="busy()" class="min-w-0">
          <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label class="block lg:col-span-3">
              <span class="app-label">{{ prefs.txt('গ্রহণ ক্লেইম', 'Linked Intake Receipt') }} *</span>
              <select [ngModel]="form().receiptId" (ngModelChange)="pickReceipt($event)" class="app-input" required>
                <option [ngValue]="null">{{ prefs.txt('গ্রহণ ক্লেইম নির্বাচন করুন', 'Select an intake receipt') }}</option>
                @if (unavailableReceipt()) {
                  <option [ngValue]="form().receiptId" disabled>{{ form().receiptClaimNo || form().receiptId }} — {{ prefs.txt('পাওয়া যায়নি / ব্যবহৃত', 'Missing / already used') }}</option>
                }
                @for (receipt of receiptOptions(); track receipt.id) {
                  <option [ngValue]="receipt.id">{{ receipt.claimNo }} — {{ receipt.customerName }} — {{ receipt.productName }} · {{ receipt.serialNumber || '—' }}</option>
                }
              </select>
              <span class="hint">{{ prefs.txt('ক্লেইম বদলালে কাস্টমার, পণ্য, পরিমাণ ও সরবরাহকারীর তথ্য নতুন করে আসবে।', 'Changing the receipt reloads its customer, product, quantity and supplier details.') }}</span>
            </label>
            <label class="block"><span class="app-label">{{ prefs.txt('পরিবর্তনের তারিখ', 'Replacement Date') }} *</span><input type="date" appDmyDate [ngModel]="form().date" (ngModelChange)="set('date', $event)" class="app-input" required /></label>

            @if (selectedReceipt(); as receipt) {
              <div class="sm:col-span-2 lg:col-span-4 rounded-lg border border-teal-200 bg-teal-50/60 dark:border-teal-800 dark:bg-teal-900/20 p-3 text-[11px]">
                <p class="font-bold text-teal-800 dark:text-teal-200">{{ receipt.claimNo }} · {{ receipt.customerName }} · {{ receipt.phone || '—' }}</p>
                <p class="mt-1">{{ prefs.txt('জমা পণ্য', 'Received product') }}: {{ receipt.productName }} · {{ receipt.quantity }} {{ receipt.unit }} · {{ prefs.txt('পুরাতন সিরিয়াল', 'Old serial') }}: <span class="font-mono">{{ receipt.serialNumber || '—' }}</span></p>
                <p>{{ prefs.txt('ইনভয়েস', 'Invoice') }}: {{ receipt.invoiceNumber || '—' }} · {{ prefs.txt('কন্ডিশন', 'Condition') }}: {{ receipt.condition || '—' }} · {{ receipt.stockIn ? prefs.txt('গ্রহণ স্টকে জমা হয়েছে', 'Booked into intake stock') : prefs.txt('গ্রহণ স্টকে জমা হয়নি', 'Not booked into intake stock') }}</p>
                @if (receipt.address) { <p>{{ prefs.txt('ঠিকানা', 'Address') }}: {{ addr(receipt.address) }}</p> }
                @if (receipt.reason) { <p class="whitespace-pre-line">{{ prefs.txt('সমস্যা', 'Fault') }}: {{ receipt.reason }}</p> }
              </div>
            }
            <label class="block"><span class="app-label">{{ prefs.txt('কাস্টমার', 'Customer') }} *</span><input [ngModel]="form().customerName" (ngModelChange)="set('customerName', $event)" class="app-input" required /></label>
            <label class="block"><span class="app-label">{{ prefs.txt('মোবাইল', 'Phone') }}</span><input type="tel" [ngModel]="form().phone" (ngModelChange)="set('phone', $event)" class="app-input font-mono" /></label>
            <label class="block"><span class="app-label">{{ prefs.txt('কার্যকরী ধাপ (স্টক নিয়ন্ত্রণ)', 'Operational Stage (Stock Control)') }} *</span>
              <select [ngModel]="form().stage" (ngModelChange)="set('stage', $event)" class="app-input">
                @for (stage of stages; track stage) { <option [ngValue]="stage">{{ stageText(stage) }}</option> }
              </select>
            </label>
            <label class="block"><span class="app-label">{{ prefs.txt('নিজস্ব অবস্থা', 'Custom Status') }}</span>
              <select [ngModel]="form().status" (ngModelChange)="set('status', $event)" class="app-input">
                @for (status of statusOptions(); track status) { <option [ngValue]="status">{{ status || prefs.txt('অনির্ধারিত', 'Unspecified') }}</option> }
              </select>
            </label>
            <p class="sm:col-span-2 lg:col-span-4 hint">{{ prefs.txt('শুধু সম্পন্ন ধাপে স্টক যোগ/বিয়োগ হবে। অপেক্ষমাণ বা বাতিল ধাপে কোনো স্টক চলাচল হবে না। নিজস্ব অবস্থা স্টক নিয়ন্ত্রণ করে না।', 'Only Completed moves stock. Pending and Cancelled do not post stock movements. Custom status does not control stock.') }}</p>
            @if (customerMismatch()) {
              <p class="sm:col-span-2 lg:col-span-4 text-amber-700 dark:text-amber-300">{{ prefs.txt('কাস্টমার/মোবাইল গ্রহণ ক্লেইমের সঙ্গে মিলছে না। সেভের আগে নিশ্চিত করতে হবে; মূল গ্রহণ ক্লেইম বদলাবে না।', 'Customer/phone differs from the linked receipt. Saving requires confirmation; the original receipt will not change.') }}</p>
            }

            <label class="block lg:col-span-2"><span class="app-label">{{ prefs.txt('পরিবর্তিত পণ্য', 'Replacement Product') }} *</span>
              <select [ngModel]="form().productId" (ngModelChange)="pickProduct($event)" class="app-input">
                <option [ngValue]="null">{{ prefs.txt('নাম দিয়ে পণ্য / নির্বাচন করুন', 'Named product / select product') }}</option>
                @if (missingProduct()) { <option [ngValue]="form().productId">{{ form().productName }} — {{ prefs.txt('তালিকা থেকে সরানো', 'Removed from catalog') }}</option> }
                @for (product of products(); track product.id) { <option [ngValue]="product.id">{{ product.name }}</option> }
              </select>
              @if (form().productId === null) {
                <input [ngModel]="form().productName" (ngModelChange)="set('productName', $event)" [attr.aria-label]="prefs.txt('পণ্যের নাম', 'Product name')" [placeholder]="prefs.txt('পণ্যের নাম লিখুন', 'Enter product name')" class="app-input mt-1" />
              }
            </label>
            <label class="block"><span class="app-label">{{ prefs.txt('নতুন সিরিয়াল / IMEI', 'New Serial / IMEI') }} @if (settings().requireSerial) { * }</span><input [ngModel]="form().serialNumber" (ngModelChange)="set('serialNumber', $event)" class="app-input font-mono" /><span class="hint">{{ prefs.txt('পুরাতন সিরিয়াল নয়, দেওয়া ইউনিটের সিরিয়াল লিখুন।', 'Enter the issued unit’s serial, not the faulty unit’s serial.') }}</span></label>
            <div class="grid grid-cols-2 gap-2">
              <label><span class="app-label">{{ prefs.txt('পরিমাণ', 'Quantity') }} *</span><input type="number" min="0" step="any" [ngModel]="form().quantity" (ngModelChange)="set('quantity', $event)" class="app-input font-mono" /></label>
              <label><span class="app-label">{{ prefs.txt('একক', 'Unit') }}</span><input [ngModel]="form().unit" (ngModelChange)="set('unit', $event)" class="app-input" /></label>
            </div>

            <label class="block"><span class="app-label">{{ prefs.txt('স্টকের উৎস', 'Stock Source') }}</span>
              <select [ngModel]="form().source" (ngModelChange)="set('source', $event)" class="app-input">
                <option value="warranty">{{ prefs.txt('আলাদা ওয়ারেন্টি স্টক', 'Dedicated warranty stock') }}</option>
                @if (settings().allowMainStockReplacement || form().source === 'main') { <option value="main" [disabled]="!settings().allowMainStockReplacement">{{ prefs.txt('মূল পণ্যের স্টক', 'Main product stock') }}</option> }
              </select>
              @if (!settings().allowMainStockReplacement) { <span class="hint">{{ prefs.txt('সেটিংসে মূল স্টক থেকে পরিবর্তন বন্ধ।', 'Main-stock replacement is disabled in settings.') }}</span> }
            </label>
            <label class="block"><span class="app-label">{{ prefs.txt('সরবরাহকারী থেকে স্টক ইন', 'Supplier Inbound Quantity') }}</span><input type="number" min="0" step="any" [ngModel]="form().stockInQty" (ngModelChange)="set('stockInQty', $event)" class="app-input font-mono" /><span class="hint">{{ prefs.txt('এই ভাউচারে আলাদা ওয়ারেন্টি স্টকে যোগ হবে।', 'Adds to dedicated warranty stock on this voucher.') }}</span></label>
            <div class="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
              <p class="app-label">{{ prefs.txt('সম্পন্ন করার সময় ইস্যুর জন্য পাওয়া যাবে', 'Available to Issue on Completion') }}</p>
              <p class="font-mono text-lg font-bold text-teal-700 dark:text-teal-300">{{ stockPreview().available | number:'1.0-4' }} <span class="text-xs">{{ form().unit }}</span></p>
              <p class="hint">{{ prefs.txt('এডিটে পুরাতন ভাউচারের প্রভাব বাদ দেওয়া হয়েছে। ওয়ারেন্টি স্টকে এই ভাউচারের ইনবাউন্ড অন্তর্ভুক্ত; মূল স্টকে নয়।', 'Excludes the old voucher when editing. Warranty availability includes this voucher’s inbound; main-stock availability does not.') }}</p>
            </div>

            <label class="block"><span class="app-label">{{ prefs.txt('সরবরাহকারী', 'Supplier') }}</span>
              <select [ngModel]="form().supplierId" (ngModelChange)="pickSupplier($event)" class="app-input">
                <option [ngValue]="null">{{ prefs.txt('ঐচ্ছিক / নাম লিখুন', 'Optional / enter name') }}</option>
                @if (missingSupplier()) { <option [ngValue]="form().supplierId">{{ form().supplierName }} — {{ prefs.txt('তালিকায় নেই', 'Not in list') }}</option> }
                @for (supplier of suppliers(); track supplier.id) { <option [ngValue]="supplier.id">{{ supplier.name }}</option> }
              </select>
              @if (form().supplierId === null) { <input [ngModel]="form().supplierName" (ngModelChange)="set('supplierName', $event)" [attr.aria-label]="prefs.txt('সরবরাহকারীর নাম', 'Supplier name')" [placeholder]="prefs.txt('সরবরাহকারীর নাম', 'Supplier name')" class="app-input mt-1" /> }
            </label>
            <label class="block"><span class="app-label">{{ prefs.txt('সরবরাহকারী রেফারেন্স', 'Supplier Reference') }}</span><input [ngModel]="form().supplierRef" (ngModelChange)="set('supplierRef', $event)" class="app-input" /></label>
            <label class="block"><span class="app-label">{{ prefs.txt('খরচ (তথ্যমাত্র)', 'Cost (Informational)') }}</span><input type="number" min="0" step="any" [ngModel]="form().cost" (ngModelChange)="set('cost', $event)" class="app-input font-mono" /><span class="hint">{{ prefs.txt('পেমেন্ট বা ওয়ালেট লেনদেন তৈরি হবে না।', 'Does not create a payment or wallet transaction.') }}</span></label>
            <label class="block"><span class="app-label">{{ prefs.txt('প্রদানকারী', 'Handled By') }}</span><input [ngModel]="form().handledBy" (ngModelChange)="set('handledBy', $event)" class="app-input" /></label>
            <div class="lg:col-span-2">
              <label class="flex items-center gap-2 font-semibold"><input type="checkbox" [ngModel]="form().disposeReceived" (ngModelChange)="set('disposeReceived', $event)" class="h-4 w-4 accent-teal-600" />{{ prefs.txt('পুরাতন ইউনিট গ্রহণ স্টক থেকে বাদ দিন', 'Remove faulty units from intake stock') }}</label>
              <p class="hint mt-1">{{ prefs.txt('সম্পন্ন হলে সংযুক্ত গ্রহণ ক্লেইমের পুরো জমা পরিমাণ বাদ যাবে।', 'On completion, removes the full stocked quantity of the linked receipt.') }}</p>
            </div>
            <label class="block lg:col-span-2"><span class="app-label">{{ prefs.txt('পুরাতন ইউনিটের ব্যবস্থা', 'Faulty Unit Disposition') }}</span>
              <select [ngModel]="form().disposition" (ngModelChange)="set('disposition', $event)" class="app-input">
                @for (item of dispositionOptions(); track item) { <option [ngValue]="item">{{ item || prefs.txt('অনির্ধারিত', 'Unspecified') }}</option> }
              </select>
            </label>
            <label class="block sm:col-span-2 lg:col-span-4"><span class="app-label">{{ prefs.txt('নোট', 'Notes') }}</span><textarea rows="2" [ngModel]="form().notes" (ngModelChange)="set('notes', $event)" class="app-input resize-y"></textarea></label>
          </div>
        </fieldset>
        @if (formError()) { <p role="alert" class="mx-4 mb-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 px-3 py-2 font-semibold">{{ formError() }}</p> }
      </section>
      } @else {

      <header class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">swap_horiz</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                {{ prefs.txt('পরিবর্তন', 'Replacement') }}
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('ওয়ারেন্টি পরিবর্তন', 'Warranty Replacement') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('পরিবর্তন তালিকা। নতুন পরিবর্তন আলাদা ফরম থেকে দিন।', 'Replacement list. Raise a new replacement from its own form.') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" (click)="exportExcel()" class="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/20 cursor-pointer"><mat-icon class="text-xs">file_download</mat-icon>{{ prefs.txt('এক্সপোর্ট', 'Export') }}</button>
            <a routerLink="/warranty/replace/new" class="inline-flex items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 transition hover:bg-teal-50"><mat-icon class="text-xs">add</mat-icon>{{ prefs.txt('নতুন পরিবর্তন', 'New Replacement') }}</a>
          </div>
        </div>
      </header>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div class="panel px-3 py-2"><p class="app-label">{{ prefs.txt('মোট পরিবর্তন', 'Total Replacements') }}</p><p class="text-lg font-bold font-mono text-teal-700 dark:text-teal-300">{{ rows().length }}</p></div>
        @for (stage of stages; track stage) {
          <div class="panel px-3 py-2"><p class="app-label">{{ stageText(stage) }}</p><p class="text-lg font-bold font-mono">{{ stageCounts()[stage] }}</p></div>
        }
      </div>

      <div class="panel p-3 flex flex-wrap items-end gap-2">
        <label class="block flex-1 min-w-[200px]"><span class="app-label">{{ prefs.txt('সার্চ', 'Search') }}</span><input [ngModel]="query()" (ngModelChange)="filter('query', $event)" [placeholder]="prefs.txt('ক্লেইম, কাস্টমার, পণ্য, সিরিয়াল, রেফারেন্স...', 'Claim, customer, product, serial, reference...')" class="app-input" /></label>
        <label><span class="app-label">{{ prefs.txt('কার্যকরী ধাপ', 'Stage') }}</span><select [ngModel]="stageFilter()" (ngModelChange)="filter('stage', $event)" class="app-input"><option value="">{{ prefs.txt('সব', 'All') }}</option>@for (stage of stages; track stage) { <option [ngValue]="stage">{{ stageText(stage) }}</option> }</select></label>
        <label><span class="app-label">{{ prefs.txt('নিজস্ব অবস্থা', 'Custom Status') }}</span><select [ngModel]="statusFilter()" (ngModelChange)="filter('status', $event)" class="app-input"><option value="">{{ prefs.txt('সব', 'All') }}</option>@for (status of filterStatuses(); track status) { <option [ngValue]="status">{{ status }}</option> }</select></label>
        <label><span class="app-label">{{ prefs.txt('শুরু', 'From') }}</span><input type="date" appDmyDate [ngModel]="fromDate()" (ngModelChange)="filter('from', $event)" class="app-input" /></label>
        <label><span class="app-label">{{ prefs.txt('শেষ', 'To') }}</span><input type="date" appDmyDate [ngModel]="toDate()" (ngModelChange)="filter('to', $event)" class="app-input" /></label>
        <button type="button" (click)="clearFilters()" class="secondary">{{ prefs.txt('ফিল্টার মুছুন', 'Clear Filters') }}</button>
        <span class="hint pb-2">{{ filtered().length }} {{ prefs.txt('রেকর্ড', 'records') }}</span>
        @if (filterDateError()) { <p role="alert" class="w-full text-rose-600 dark:text-rose-300">{{ prefs.txt('ফিল্টারের সঠিক তারিখ ও তারিখের ক্রম দিন।', 'Enter valid filter dates with From no later than To.') }}</p> }
      </div>

      <div class="panel overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[1100px] text-left border-collapse">
            <thead><tr class="bg-teal-700 text-white text-[10px] uppercase tracking-wide">
              <th class="p-2.5">{{ prefs.txt('ক্রম', 'SL') }}</th><th class="p-2.5">{{ prefs.txt('ক্লেইম / গ্রহণ', 'Claim / Receipt') }}</th><th class="p-2.5">{{ prefs.txt('তারিখ', 'Date') }}</th><th class="p-2.5">{{ prefs.txt('কাস্টমার', 'Customer') }}</th><th class="p-2.5">{{ prefs.txt('পণ্য / সিরিয়াল', 'Product / Serial') }}</th><th class="p-2.5 text-right">{{ prefs.txt('পরিমাণ', 'Qty') }}</th><th class="p-2.5">{{ prefs.txt('স্টকের উৎস', 'Stock Source') }}</th><th class="p-2.5">{{ prefs.txt('ধাপ / অবস্থা', 'Stage / Status') }}</th><th class="p-2.5 text-center">{{ prefs.txt('অ্যাকশন', 'Actions') }}</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (row of pager.paged(); track row.id; let index = $index) {
                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td class="p-2.5 text-slate-400 font-mono">{{ pager.offset() + index + 1 }}</td>
                  <td class="p-2.5"><span class="font-mono font-bold text-teal-700 dark:text-teal-300">{{ row.claimNo }}</span><span class="block hint font-mono">{{ row.receiptClaimNo || '—' }}</span></td>
                  <td class="p-2.5 whitespace-nowrap">{{ dateText(row.date) }}</td>
                  <td class="p-2.5 font-semibold">{{ row.customerName }}<span class="block hint font-mono">{{ row.phone || '—' }}</span></td>
                  <td class="p-2.5 font-semibold">{{ row.productName }}<span class="block hint font-mono">{{ row.serialNumber || '—' }}</span></td>
                  <td class="p-2.5 text-right font-mono">{{ row.quantity }} {{ row.unit }}</td>
                  <td class="p-2.5">{{ sourceText(row.source) }}<span class="block hint">{{ prefs.txt('ইনবাউন্ড', 'Inbound') }}: {{ row.stockInQty }}</span></td>
                  <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold" [class]="stageClass(stageOf(row))">{{ stageText(stageOf(row)) }}</span><span class="block hint mt-1">{{ row.status || '—' }}</span></td>
                  <td class="p-2.5 text-center whitespace-nowrap">
                    <button type="button" (click)="view.set(row)" [title]="prefs.txt('বিস্তারিত', 'Details')" [attr.aria-label]="prefs.txt('বিস্তারিত', 'Details')" class="action text-teal-600"><mat-icon class="text-sm">visibility</mat-icon></button>
                    <button type="button" (click)="printRow(row)" [title]="prefs.txt('প্রিন্ট প্রিভিউ', 'Print Preview')" [attr.aria-label]="prefs.txt('প্রিন্ট প্রিভিউ', 'Print Preview')" class="action text-slate-500"><mat-icon class="text-sm">print</mat-icon></button>
                    <button type="button" (click)="editReplacement(row)" [disabled]="busy()" [title]="prefs.txt('এডিট', 'Edit')" [attr.aria-label]="prefs.txt('এডিট', 'Edit')" class="action text-sky-600"><mat-icon class="text-sm">edit</mat-icon></button>
                    <button type="button" (click)="remove(row)" [disabled]="busy()" [title]="prefs.txt('ডিলিট', 'Delete')" [attr.aria-label]="prefs.txt('ডিলিট', 'Delete')" class="action text-rose-600"><mat-icon class="text-sm">delete</mat-icon></button>
                  </td>
                </tr>
              } @empty { <tr><td colspan="9" class="p-10 text-center text-slate-500">{{ prefs.txt('কোনো পরিবর্তন রেকর্ড পাওয়া যায়নি।', 'No replacement records found.') }}</td></tr> }
            </tbody>
          </table>
        </div>
        <app-table-pagination [total]="pager.total()" [page]="pager.currentPage()" [pageSize]="pager.pageSize()" (pageChange)="pager.setPage($event)" (pageSizeChange)="pager.setPageSize($event)" />
      </div>
      }
    </div>

    @if (view(); as row) {
      <div class="no-print fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 flex items-center justify-center p-4" (click)="view.set(null)">
        <section role="dialog" aria-modal="true" aria-labelledby="wx-detail-title" tabindex="-1" (keydown.escape)="view.set(null)" (click)="$event.stopPropagation()" class="panel w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 text-xs text-slate-800 dark:text-slate-200">
          <header class="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3 mb-3"><h2 id="wx-detail-title" class="font-bold text-base font-mono text-teal-700 dark:text-teal-300">{{ row.claimNo }}</h2><button type="button" (click)="view.set(null)" [attr.aria-label]="prefs.txt('বন্ধ', 'Close')" class="action"><mat-icon>close</mat-icon></button></header>
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3 detail-list">
            <div><dt>{{ prefs.txt('তারিখ', 'Date') }}</dt><dd>{{ dateText(row.date) }}</dd></div>
            <div><dt>{{ prefs.txt('গ্রহণ ক্লেইম', 'Linked Receipt') }}</dt><dd>{{ row.receiptClaimNo || '—' }}</dd></div>
            <div><dt>{{ prefs.txt('কার্যকরী ধাপ', 'Operational Stage') }}</dt><dd>{{ stageText(stageOf(row)) }}</dd></div>
            <div><dt>{{ prefs.txt('নিজস্ব অবস্থা', 'Custom Status') }}</dt><dd>{{ row.status || '—' }}</dd></div>
            <div><dt>{{ prefs.txt('কাস্টমার', 'Customer') }}</dt><dd>{{ row.customerName }}</dd></div>
            <div><dt>{{ prefs.txt('মোবাইল', 'Phone') }}</dt><dd>{{ row.phone || '—' }}</dd></div>
            <div><dt>{{ prefs.txt('পরিবর্তিত পণ্য', 'Replacement Product') }}</dt><dd>{{ row.productName }}</dd></div>
            <div><dt>{{ prefs.txt('নতুন সিরিয়াল', 'New Serial') }}</dt><dd class="font-mono">{{ row.serialNumber || '—' }}</dd></div>
            <div><dt>{{ prefs.txt('পরিমাণ', 'Quantity') }}</dt><dd>{{ row.quantity }} {{ row.unit }}</dd></div>
            <div><dt>{{ prefs.txt('স্টকের উৎস', 'Stock Source') }}</dt><dd>{{ sourceText(row.source) }}</dd></div>
            <div><dt>{{ prefs.txt('সরবরাহকারী ইনবাউন্ড', 'Supplier Inbound') }}</dt><dd>{{ row.stockInQty }} {{ row.unit }}</dd></div>
            <div><dt>{{ prefs.txt('সরবরাহকারী', 'Supplier') }}</dt><dd>{{ row.supplierName || '—' }}</dd></div>
            <div><dt>{{ prefs.txt('সরবরাহকারী রেফারেন্স', 'Supplier Reference') }}</dt><dd>{{ row.supplierRef || '—' }}</dd></div>
            <div><dt>{{ prefs.txt('গ্রহণ স্টক থেকে বাদ', 'Remove From Intake Stock') }}</dt><dd>{{ row.disposeReceived ? prefs.txt('হ্যাঁ (সম্পন্ন হলে)', 'Yes (on completion)') : prefs.txt('না', 'No') }}</dd></div>
            <div><dt>{{ prefs.txt('পুরাতন ইউনিটের ব্যবস্থা', 'Faulty Unit Disposition') }}</dt><dd>{{ row.disposition || '—' }}</dd></div>
            <div><dt>{{ prefs.txt('খরচ (পেমেন্ট নয়)', 'Cost (Not a Payment)') }}</dt><dd>{{ row.cost | number:'1.0-2' }}</dd></div>
            <div><dt>{{ prefs.txt('প্রদানকারী', 'Handled By') }}</dt><dd>{{ row.handledBy || '—' }}</dd></div>
            <div class="sm:col-span-2"><dt>{{ prefs.txt('নোট', 'Notes') }}</dt><dd class="whitespace-pre-line">{{ row.notes || '—' }}</dd></div>
          </dl>
          @if (stageOf(row) !== 'completed') { <p class="mt-3 text-amber-700 dark:text-amber-300">{{ prefs.txt('এই ধাপে কোনো স্টক চলাচল হয় না।', 'This stage does not post stock movements.') }}</p> }
          <div class="flex justify-end gap-2 mt-4"><button type="button" (click)="editReplacement(row)" [disabled]="busy()" class="secondary">{{ prefs.txt('এডিট', 'Edit') }}</button><button type="button" (click)="printRow(row)" class="primary">{{ prefs.txt('প্রিন্ট প্রিভিউ', 'Print Preview') }}</button></div>
        </section>
      </div>
    }
    @if (voucherReplacement(); as row) { <app-warranty-claim [replacement]="row" (close)="voucherReplacement.set(null)" /> }
  `,
  styles: [`
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
    .app-label, .detail-list dt { display: block; font-size: 10px; font-weight: 700; color: #64748b; margin-bottom: 3px; }
    .app-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 7px 9px; font-size: 12px; color: #0f172a; outline: none; }
    .app-input:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,.15); }
    .hint { font-size: 10px; font-weight: 400; color: #64748b; }
    .primary, .secondary { padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .primary { background: #0d9488; color: #fff; }
    .primary:hover { background: #0f766e; }
    .secondary { border: 1px solid #cbd5e1; }
    .secondary:hover, .action:hover { background: #f1f5f9; }
    .action { padding: 4px; border-radius: 5px; cursor: pointer; }
    button:disabled, input:disabled, select:disabled { opacity: .55; cursor: not-allowed; }
    .detail-list dd { font-weight: 600; overflow-wrap: anywhere; }
    :host-context(.dark) .panel { background: #0f172a; border-color: #334155; }
    :host-context(.dark) .app-input { background: #0b1220; border-color: #475569; color: #e2e8f0; }
    :host-context(.dark) .app-label, :host-context(.dark) .hint, :host-context(.dark) .detail-list dt { color: #94a3b8; }
    :host-context(.dark) .secondary { border-color: #475569; }
    :host-context(.dark) .secondary:hover, :host-context(.dark) .action:hover { background: #1e293b; }
  `]
})
export class WarrantyReplace {
  private readonly dataService = inject(DataService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly prefs = inject(PreferencesService);

  addr(value?: string): string {
    return localizeAddress(value, this.prefs.language());
  }
  /** The list and the form live on separate routes; only one is rendered at a time. */
  readonly isFormView = this.route.snapshot.data['warrantyView'] === 'form';
  readonly settings = this.dataService.warrantySettings;
  readonly dateText = (value: string) => dmyFromIso(isoDay(value));
  readonly stages: readonly ReplacementStage[] = ['completed', 'pending', 'cancelled'];
  readonly editId = signal<number | null>(null);
  private readonly editingRecord = signal<StagedReplacement | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly view = signal<WarrantyReplacement | null>(null);
  readonly voucherReplacement = signal<WarrantyReplacement | null>(null);
  readonly form = signal<ReplacementForm>(this.emptyForm());
  private readonly cleanForm = signal(JSON.stringify(this.form()));
  readonly isDirty = computed(() => JSON.stringify(this.form()) !== this.cleanForm());
  readonly claimNo = computed(() => this.editingRecord()?.claimNo ?? this.dataService.peekWarrantyReplacementNo());
  readonly query = signal('');
  readonly stageFilter = signal('');
  readonly statusFilter = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');

  readonly rows = computed(() => this.dataService.warrantyReplacements().slice()
    .sort((a, b) => isoDay(b.date).localeCompare(isoDay(a.date)) || b.claimNo.localeCompare(a.claimNo, undefined, { numeric: true })));
  readonly products = computed(() => this.dataService.products().slice().sort((a, b) => a.name.localeCompare(b.name)));
  readonly suppliers = computed(() => this.dataService.parties()
    .filter(p => (p.roles?.length ? p.roles : [p.type]).includes('Supplier'))
    .slice().sort((a, b) => a.name.localeCompare(b.name)));
  readonly missingProduct = computed(() => this.form().productId !== null && !this.products().some(p => p.id === this.form().productId));
  readonly missingSupplier = computed(() => this.form().supplierId !== null && !this.suppliers().some(p => p.id === this.form().supplierId));
  readonly receiptOptions = computed(() => {
    const used = new Set(this.rows().filter(row => row.id !== this.editId() && this.stageOf(row) !== 'cancelled').map(row => row.receiptId));
    return this.dataService.warrantyReceipts().filter(row =>
      !row.replacementClaimNo && !used.has(row.id)
      && !isWarrantyCompleted(row.status) && !isWarrantyCancelled(row.status)).slice()
      .sort((a, b) => isoDay(b.date).localeCompare(isoDay(a.date)) || b.id - a.id);
  });
  readonly selectedReceipt = computed(() => this.dataService.warrantyReceipts().find(row => row.id === this.form().receiptId));
  readonly unavailableReceipt = computed(() => this.form().receiptId !== null && !this.receiptOptions().some(row => row.id === this.form().receiptId));
  readonly statusOptions = computed(() => [...new Set([...this.settings().replacementStatuses, this.form().status])]);
  readonly dispositionOptions = computed(() => [...new Set([...this.settings().dispositions, this.form().disposition])]);
  readonly filterStatuses = computed(() => [...new Set([...this.settings().replacementStatuses, ...this.rows().map(row => row.status)])].filter(Boolean));
  readonly customerMismatch = computed(() => {
    const receipt = this.selectedReceipt();
    return !!receipt && (this.form().customerName.trim() !== receipt.customerName.trim() || this.form().phone.trim() !== (receipt.phone || '').trim());
  });
  readonly stageCounts = computed(() => {
    const counts: Record<ReplacementStage, number> = { completed: 0, pending: 0, cancelled: 0 };
    for (const row of this.rows()) counts[this.stageOf(row)]++;
    return counts;
  });

  // Preview the same balances that service validation sees after reversing an edit.
  // Inbound always enters the warranty pool, even when issuing from main stock.
  readonly stockPreview = computed(() => {
    const form = this.form();
    const key = this.dataService.warrantyStockKey(form.productId ?? undefined, form.productName, form.unit);
    const pool = this.dataService.warrantyStockOf(form.productId ?? undefined, form.productName, form.unit);
    let warranty = pool.replacement;
    let main = this.products().find(p => p.id === form.productId)?.stock ?? 0;
    const old = this.dataService.warrantyReplacements().find(row => row.id === this.editId());
    if (old && this.stageOf(old) === 'completed' && this.dataService.warrantyStockKey(old.productId, old.productName, old.unit) === key) {
      warranty -= old.stockInQty;
      if (old.source === 'main') main += old.quantity;
      else warranty += old.quantity;
    }
    const inbound = Number.isFinite(form.stockInQty) ? Math.max(0, form.stockInQty ?? 0) : 0;
    return { available: form.source === 'main' ? main : warranty + inbound };
  });

  readonly filterDateError = computed(() => {
    const from = this.fromDate();
    const to = this.toDate();
    return !!((from && !this.validDate(from)) || (to && !this.validDate(to)) || (from && to && isoDay(from) > isoDay(to)));
  });
  readonly filtered = computed(() => {
    if (this.filterDateError()) return [];
    const q = this.query().trim().toLowerCase();
    const from = isoDay(this.fromDate());
    const to = isoDay(this.toDate());
    const receipts = new Map(this.dataService.warrantyReceipts().map(row => [row.id, row]));
    return this.rows().filter(row => {
      if (this.stageFilter() && this.stageOf(row) !== this.stageFilter()) return false;
      if (this.statusFilter() && row.status !== this.statusFilter()) return false;
      const day = isoDay(row.date);
      if ((from && day < from) || (to && day > to)) return false;
      const receipt = row.receiptId == null ? undefined : receipts.get(row.receiptId);
      return !q || [row.claimNo, row.receiptClaimNo, row.customerName, row.phone, row.productName, row.serialNumber,
        row.supplierName, row.supplierRef, row.status, this.stageOf(row), this.stageText(this.stageOf(row)),
        row.disposition, row.handledBy, row.notes, receipt?.invoiceNumber, receipt?.serialNumber]
        .some(value => (value || '').toLowerCase().includes(q));
    });
  });
  readonly pager = createPager(() => this.filtered());

  constructor() {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      const id = Number(idParam);
      const record = /^\d+$/.test(idParam) ? this.dataService.warrantyReplacements().find(item => item.id === id) : undefined;
      if (!record) {
        this.notify.error(
          this.prefs.txt('পরিবর্তন ক্লেইমটি খুঁজে পাওয়া যায়নি।', 'Replacement not found.'),
          this.prefs.txt('খুঁজে পাওয়া যায়নি', 'Not found')
        );
        this.router.navigate(['/warranty/replace']);
        return;
      }
      this.loadRecord(record);
      return;
    }
    const receiptParam = this.route.snapshot.queryParamMap.get('receipt');
    if (receiptParam !== null) {
      const id = Number(receiptParam);
      const receipt = /^\d+$/.test(receiptParam) && Number.isSafeInteger(id) ? this.receiptOptions().find(row => row.id === id) : undefined;
      if (receipt) {
        this.populateReceipt(receipt);
        // A prefilled receipt is the form's starting state, not an unsaved change.
        this.cleanForm.set(JSON.stringify(this.form()));
      } else this.formError.set(this.prefs.txt('লিংকের গ্রহণ ক্লেইম পাওয়া যায়নি বা অন্য পরিবর্তনে ব্যবহৃত হয়েছে।', 'The linked receipt is missing or already used by another replacement.'));
    }
  }

  stageOf(row: StagedReplacement): ReplacementStage {
    return row.stage === 'pending' || row.stage === 'cancelled' ? row.stage : 'completed';
  }

  stageText(stage: ReplacementStage): string {
    switch (stage) {
      case 'completed': return this.prefs.txt('সম্পন্ন', 'Completed');
      case 'pending': return this.prefs.txt('অপেক্ষমাণ', 'Pending');
      case 'cancelled': return this.prefs.txt('বাতিল', 'Cancelled');
    }
  }

  stageClass(stage: ReplacementStage): string {
    if (stage === 'completed') return 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200';
    if (stage === 'pending') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
    return 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  }

  sourceText(source: 'warranty' | 'main'): string {
    return source === 'main' ? this.prefs.txt('মূল স্টক', 'Main Stock') : this.prefs.txt('ওয়ারেন্টি স্টক', 'Warranty Stock');
  }

  set<K extends keyof ReplacementForm>(key: K, value: ReplacementForm[K]) {
    this.form.update(current => ({ ...current, [key]: value }));
    this.formError.set('');
  }

  async pickReceipt(receiptId: number | null) {
    if (this.busy() || receiptId === this.form().receiptId) return;
    const previous = this.form();
    // Update the select immediately, so declining the confirmation restores it too.
    this.set('receiptId', receiptId);
    this.busy.set(true);
    try {
      if (previous.receiptId !== null || previous.customerName || previous.productName) {
        const ok = await this.notify.confirm(this.prefs.txt(
          'গ্রহণ ক্লেইম বদলালে কাস্টমার, মোবাইল, পণ্য, পরিমাণ, সরবরাহকারী ও নোট নতুন করে আসবে এবং নতুন সিরিয়াল মুছে যাবে। চালিয়ে যাবেন?',
          'Changing the receipt reloads customer, phone, product, quantity, supplier and notes, and clears the new serial. Continue?'
        ), { title: this.prefs.txt('গ্রহণ ক্লেইম বদলান?', 'Change linked receipt?') });
        if (!ok) { this.form.set(previous); return; }
      }
      if (receiptId === null) {
        this.form.update(current => ({ ...current, receiptClaimNo: '', customerName: '', phone: '' }));
        return;
      }
      const receipt = this.receiptOptions().find(row => row.id === receiptId);
      if (!receipt) {
        this.form.set(previous);
        this.formError.set(this.errorText('settled'));
        return;
      }
      this.populateReceipt(receipt);
    } finally {
      this.busy.set(false);
    }
  }

  private populateReceipt(receipt: WarrantyReceipt) {
    this.form.update(current => ({
      ...current,
      receiptId: receipt.id,
      receiptClaimNo: receipt.claimNo,
      customerName: receipt.customerName || '',
      phone: receipt.phone || '',
      productId: receipt.productId ?? null,
      productName: receipt.productName || '',
      serialNumber: '',
      quantity: receipt.quantity,
      unit: receipt.unit ?? '',
      supplierId: receipt.supplierId ?? null,
      supplierName: receipt.supplierName ?? '',
      supplierRef: '',
      disposeReceived: receipt.stockIn,
      notes: receipt.notes ?? '',
      handledBy: receipt.handledBy ?? ''
    }));
    this.formError.set('');
  }

  pickProduct(productId: number | null) {
    const product = this.products().find(row => row.id === productId);
    this.form.update(current => ({ ...current, productId, productName: product?.name ?? '', unit: product?.unit ?? current.unit, serialNumber: '' }));
    this.formError.set('');
  }

  pickSupplier(supplierId: number | null) {
    const supplier = this.suppliers().find(row => row.id === supplierId);
    this.form.update(current => ({ ...current, supplierId, supplierName: supplier?.name ?? '' }));
  }

  private emptyForm(): ReplacementForm {
    const settings = this.settings();
    return {
      receiptId: null, receiptClaimNo: '', date: localDateIso(), customerName: '', phone: '',
      productId: null, productName: '', serialNumber: '', quantity: 1, unit: 'pcs', source: 'warranty',
      stockInQty: 0, supplierId: null, supplierName: '', supplierRef: '', disposeReceived: true,
      disposition: settings.dispositions[0] ?? '', cost: 0, stage: 'completed',
      status: settings.replacementStatuses[0] ?? '', notes: '', handledBy: ''
    };
  }

  private resetForm() {
    this.editId.set(null);
    this.editingRecord.set(null);
    this.form.set(this.emptyForm());
    this.cleanForm.set(JSON.stringify(this.form()));
    this.formError.set('');
  }

  confirmLeave(): boolean | Promise<boolean> {
    if (this.busy()) return false;
    return !this.isDirty() || this.notify.confirm(
      this.prefs.txt('সেভ না করা পরিবর্তন বাদ দেবেন?', 'Discard unsaved changes?'),
      { title: this.prefs.txt('পরিবর্তন বাদ দিন?', 'Discard changes?') }
    );
  }

  editReplacement(row: WarrantyReplacement) {
    if (this.busy()) return;
    this.router.navigate(['/warranty/replace', row.id, 'edit']);
  }

  /** Hydrates the standalone edit route straight from the stored replacement. */
  private loadRecord(record: WarrantyReplacement) {
    this.editId.set(record.id);
    this.editingRecord.set(record);
    // Hydrate the voucher itself, not its receipt: every edit field keeps its saved value.
    this.form.set({
      receiptId: record.receiptId ?? null, receiptClaimNo: record.receiptClaimNo ?? '',
      date: isoDay(record.date) || record.date, customerName: record.customerName, phone: record.phone ?? '',
      productId: record.productId ?? null, productName: record.productName, serialNumber: record.serialNumber ?? '',
      quantity: record.quantity, unit: record.unit ?? '', source: record.source, stockInQty: record.stockInQty ?? 0,
      supplierId: record.supplierId ?? null, supplierName: record.supplierName ?? '', supplierRef: record.supplierRef ?? '',
      disposeReceived: record.disposeReceived, disposition: record.disposition ?? '', cost: record.cost ?? 0,
      stage: this.stageOf(record), status: record.status ?? '', notes: record.notes ?? '', handledBy: record.handledBy ?? ''
    });
    this.cleanForm.set(JSON.stringify(this.form()));
    this.formError.set('');
  }

  private validDate(value: string): string {
    const day = isoDay(value);
    if (!day || day.startsWith('0000-')) return '';
    const date = new Date(day + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : '';
  }

  private validate(form: ReplacementForm): string {
    const receipt = this.dataService.warrantyReceipts().find(row => row.id === form.receiptId);
    // A cancelled voucher posts nothing, so it may outlive a cleaned-up receipt.
    if (!receipt && form.stage !== 'cancelled') return this.prefs.txt('একটি বিদ্যমান গ্রহণ ক্লেইম নির্বাচন করুন।', 'Select an existing intake receipt.');
    if (form.stage !== 'cancelled' && this.dataService.warrantyReplacements().some(row => row.id !== this.editId() && row.receiptId === form.receiptId && this.stageOf(row) !== 'cancelled')) return this.errorText('settled');
    if (!this.validDate(form.date)) return this.prefs.txt('সঠিক পরিবর্তনের তারিখ দিন।', 'Enter a valid replacement date.');
    if (!form.customerName.trim() || !form.productName.trim()) return this.prefs.txt('কাস্টমার ও পণ্যের নাম আবশ্যক।', 'Customer and product names are required.');
    if (!Number.isFinite(form.quantity) || form.quantity === null || form.quantity <= 0) return this.prefs.txt('পরিমাণ সসীম ও শূন্যের বেশি হতে হবে।', 'Quantity must be finite and greater than zero.');
    if (!Number.isFinite(form.cost) || form.cost === null || form.cost < 0 || !Number.isFinite(form.stockInQty) || form.stockInQty === null || form.stockInQty < 0) return this.prefs.txt('খরচ ও ইনবাউন্ড পরিমাণ সসীম এবং শূন্য বা বেশি হতে হবে।', 'Cost and inbound quantity must be finite, nonnegative numbers.');
    if (this.settings().requireSerial && !form.serialNumber.trim()) return this.prefs.txt('সেটিংস অনুযায়ী নতুন সিরিয়াল নম্বর আবশ্যক।', 'A new serial number is required by your settings.');
    if (!this.stages.includes(form.stage)) return this.errorText('stage');
    if (form.source !== 'warranty' && form.source !== 'main') return this.errorText('source');
    if (form.source === 'main') {
      if (!this.settings().allowMainStockReplacement) return this.errorText('main-disabled');
      if (!this.products().some(product => product.id === form.productId)) return this.errorText('main-product');
    }
    if (form.stage !== 'completed' || this.settings().allowNegativeStock) return '';
    if (form.quantity > this.stockPreview().available + 0.0001) return this.errorText(form.source === 'main' ? 'main-shortage' : 'shortage');
    if (form.disposeReceived && receipt?.stockIn) {
      let available = this.dataService.warrantyStockOf(receipt.productId, receipt.productName, receipt.unit).received;
      const old = this.dataService.warrantyReplacements().find(row => row.id === this.editId());
      const oldReceipt = old?.receiptId == null ? undefined : this.dataService.warrantyReceipts().find(row => row.id === old.receiptId);
      if (old && this.stageOf(old) === 'completed' && old.disposeReceived && oldReceipt?.stockIn
        && this.dataService.warrantyStockKey(oldReceipt.productId, oldReceipt.productName, oldReceipt.unit) === this.dataService.warrantyStockKey(receipt.productId, receipt.productName, receipt.unit)) {
        available += oldReceipt.quantity;
      }
      if (receipt.quantity > available + 0.0001) return this.errorText('received-shortage');
    }
    return '';
  }

  async save() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const form = this.form();
      let error = this.validate(form);
      if (error) { this.formError.set(error); return; }
      if (this.customerMismatch()) {
        const ok = await this.notify.confirm(this.prefs.txt(
          'কাস্টমার/মোবাইল সংযুক্ত গ্রহণ ক্লেইম থেকে আলাদা। এই তথ্যেই পরিবর্তন সেভ করবেন? গ্রহণ ক্লেইমের কাস্টমার বদলাবে না।',
          'Customer/phone differs from the linked receipt. Save with these details? The receipt’s customer will not be changed.'
        ), { title: this.prefs.txt('কাস্টমার নিশ্চিত করুন', 'Confirm customer details') });
        if (!ok) return;
      }
      // Recheck after a confirmation in case stock or receipt availability changed.
      error = this.validate(form);
      if (error) { this.formError.set(error); return; }
      const receipt = this.selectedReceipt();
      const payload: ReplacementPayload = {
        receiptId: receipt?.id ?? form.receiptId ?? undefined, receiptClaimNo: receipt?.claimNo ?? form.receiptClaimNo, date: this.validDate(form.date),
        customerName: form.customerName.trim(), phone: form.phone.trim(), productId: form.productId ?? undefined,
        productName: form.productName.trim(), serialNumber: form.serialNumber.trim(), quantity: Number(form.quantity), unit: form.unit.trim(),
        source: form.source, stockInQty: Number(form.stockInQty), supplierId: form.supplierId ?? undefined,
        supplierName: form.supplierName.trim(), supplierRef: form.supplierRef.trim(), disposeReceived: form.disposeReceived,
        disposition: form.disposition, cost: Number(form.cost), stage: form.stage, status: form.status,
        notes: form.notes.trim(), handledBy: form.handledBy.trim()
      };
      const id = this.editId();
      // No stock/payment side effects here. The service owns stage-aware posting and reversals.
      const result = id !== null ? this.dataService.updateWarrantyReplacement(id, payload) : this.dataService.recordWarrantyReplacement(payload);
      if (!result.ok) { this.formError.set(this.errorText(result.error)); return; }
      this.notify.success(id !== null ? this.prefs.txt('পরিবর্তন আপডেট হয়েছে।', 'Replacement updated.') : this.prefs.txt('পরিবর্তন ক্লেইম তৈরি হয়েছে।', 'Replacement claim created.'));
      this.resetForm();
      this.router.navigate(['/warranty/replace']);
    } finally { this.busy.set(false); }
  }

  async remove(row: WarrantyReplacement) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const ok = await this.notify.confirm(this.prefs.txt(
        `${row.claimNo} ডিলিট করবেন? পোস্ট করা স্টক ও গ্রহণ ক্লেইমের প্রভাব ফিরিয়ে নেওয়া হবে।${this.editId() === row.id && this.isDirty() ? ' সেভ না করা এডিটও হারিয়ে যাবে।' : ''}`,
        `Delete ${row.claimNo}? Posted stock and receipt effects will be reversed.${this.editId() === row.id && this.isDirty() ? ' Unsaved edits will also be lost.' : ''}`
      ), { title: this.prefs.txt('ডিলিট নিশ্চিত করুন', 'Confirm Delete') });
      if (!ok) return;
      const result = this.dataService.deleteWarrantyReplacement(row.id);
      if (!result.ok) { this.notify.error(this.errorText(result.error)); return; }
      if (this.editId() === row.id) this.resetForm();
      if (this.view()?.id === row.id) this.view.set(null);
      if (this.voucherReplacement()?.id === row.id) this.voucherReplacement.set(null);
      this.notify.success(this.prefs.txt('পরিবর্তন ডিলিট হয়েছে।', 'Replacement deleted.'));
    } finally { this.busy.set(false); }
  }

  printRow(row: WarrantyReplacement) {
    this.voucherReplacement.set(row);
  }

  filter(key: 'query' | 'stage' | 'status' | 'from' | 'to', value: string) {
    const filters = { query: this.query, stage: this.stageFilter, status: this.statusFilter, from: this.fromDate, to: this.toDate };
    filters[key].set(value);
    this.pager.setPage(1);
  }

  clearFilters() {
    for (const filter of [this.query, this.stageFilter, this.statusFilter, this.fromDate, this.toDate]) filter.set('');
    this.pager.setPage(1);
  }

  private errorText(error?: string): string {
    switch (error) {
      case 'missing': return this.prefs.txt('পরিবর্তন ক্লেইম পাওয়া যায়নি।', 'Replacement claim not found.');
      case 'receipt': case 'receipt-missing': return this.prefs.txt('সংযুক্ত গ্রহণ ক্লেইম পাওয়া যায়নি।', 'The linked intake receipt was not found.');
      case 'settled': return this.prefs.txt('এই গ্রহণ ক্লেইমে অন্য একটি বাতিল নয় এমন পরিবর্তন আছে।', 'This receipt already has another non-cancelled replacement.');
      case 'shortage': return this.prefs.txt('এই ভাউচারের ইনবাউন্ডসহ ওয়ারেন্টি পরিবর্তন স্টক যথেষ্ট নয়।', 'Insufficient warranty replacement stock, including this voucher’s inbound.');
      case 'main-shortage': return this.prefs.txt('মূল পণ্যের স্টক যথেষ্ট নয়।', 'Insufficient main product stock.');
      case 'received-shortage': return this.prefs.txt('পুরাতন ইউনিট বাদ দেওয়ার জন্য গ্রহণ স্টক যথেষ্ট নয়।', 'Insufficient intake stock to remove the faulty units.');
      case 'main-disabled': case 'main-not-allowed': return this.prefs.txt('সেটিংসে মূল স্টক থেকে পরিবর্তন অনুমোদিত নয়।', 'Main-stock replacement is not allowed by your settings.');
      case 'main-product': return this.prefs.txt('মূল স্টকের জন্য তালিকার একটি বিদ্যমান পণ্য নির্বাচন করুন।', 'Select an existing catalog product for main stock.');
      case 'product': return this.prefs.txt('সঠিক পণ্য ও শূন্যের বেশি পরিমাণ দিন।', 'Enter a valid product and positive quantity.');
      case 'stage': return this.prefs.txt('সঠিক কার্যকরী ধাপ নির্বাচন করুন।', 'Select a valid operational stage.');
      case 'source': return this.prefs.txt('সঠিক স্টকের উৎস নির্বাচন করুন।', 'Select a valid stock source.');
      case 'unit': return this.prefs.txt('মূল স্টকের জন্য পণ্যের ক্যাটালগের একক ব্যবহার করুন।', 'Use the catalog product unit for main stock.');
      case 'precision': return this.prefs.txt('পরিমাণ ও ইনবাউন্ডে সর্বোচ্চ দুই দশমিক ব্যবহার করুন।', 'Use at most two decimal places for quantity and inbound stock.');
      default: return this.prefs.txt('পরিবর্তন সংরক্ষণ করা যায়নি। তথ্য ও স্টক যাচাই করুন।', 'Could not save the replacement. Check the details and stock.');
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (!this.isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  exportExcel() {
    const rows = this.filtered().map((row, index) => ({
      SL: index + 1, 'Claim No': row.claimNo, 'Receipt ID': row.receiptId ?? '', 'Receipt Claim': row.receiptClaimNo ?? '',
      Date: isoDay(row.date), Customer: row.customerName, Phone: row.phone, 'Product ID': row.productId ?? '', Product: row.productName,
      Serial: row.serialNumber, Quantity: row.quantity, Unit: row.unit, Source: row.source, 'Supplier Inbound': row.stockInQty,
      'Supplier ID': row.supplierId ?? '', Supplier: row.supplierName ?? '', 'Supplier Ref': row.supplierRef ?? '',
      'Dispose Received': row.disposeReceived ? 'Yes' : 'No', Disposition: row.disposition, 'Cost (Informational)': row.cost,
      Stage: this.stageOf(row), Status: row.status, 'Handled By': row.handledBy ?? '', Notes: row.notes ?? ''
    }));
    this.dataService.exportToExcel(rows, 'Warranty_Replacements');
  }
}
