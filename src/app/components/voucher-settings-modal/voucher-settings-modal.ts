import { ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, VoucherSettings } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { MediaService, SIGNATURE_LIMITS } from '../../services/media';
import { PreferencesService } from '../../services/preferences';

type TermsTarget = 'sale' | 'purchase' | 'credit' | 'debit';
type TermsField = 'greeting' | 'term1' | 'term2';
type TermsKey =
  | 'greetingText' | 'term1' | 'term2'
  | 'purchaseGreeting' | 'purchaseTerm1' | 'purchaseTerm2'
  | 'creditGreeting' | 'creditTerm1' | 'creditTerm2'
  | 'debitGreeting' | 'debitTerm1' | 'debitTerm2';

@Component({
  selector: 'app-voucher-settings-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs select-none">
      
      <!-- Backdrop -->
      <div (click)="closeModal.emit()" class="fixed inset-0"></div>

      <!-- Settings Card -->
      <div class="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col z-10 overflow-hidden border border-slate-300 max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        
        <!-- Header -->
        <div class="bg-teal-700 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-2">
            <mat-icon class="text-white">tune</mat-icon>
            <div>
              <h2 class="font-bold text-base leading-tight">{{ prefs.txt('ভাউচার কাস্টমাইজেশন', 'Voucher Customization') }}</h2>
              <p class="text-[11px] text-teal-100">{{ prefs.txt('নাম, লোগো, রঙ, সেকশন, শর্ত ও স্বাক্ষর নিজের মতো সাজান', 'Arrange the name, logo, colours, sections, terms and signature your way') }}</p>
            </div>
          </div>
          <button (click)="closeModal.emit()" class="text-white hover:bg-teal-700 p-1.5 rounded-lg transition-colors cursor-pointer">
            <mat-icon class="text-sm">close</mat-icon>
          </button>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex border-b border-slate-200 bg-slate-50 px-5 text-xs font-semibold gap-4 shrink-0 overflow-x-auto">
          <button
            (click)="activeTab.set('sections')"
            [class]="activeTab() === 'sections' ? 'border-b-2 border-teal-600 text-teal-800 py-3 font-bold' : 'text-slate-600 hover:text-slate-900 py-3'"
          >
            {{ prefs.txt('১. সেকশন দেখান/লুকান', '1. Show / hide sections') }}
          </button>
          <button
            (click)="activeTab.set('branding')"
            [class]="activeTab() === 'branding' ? 'border-b-2 border-teal-600 text-teal-800 py-3 font-bold' : 'text-slate-600 hover:text-slate-900 py-3'"
          >
            {{ prefs.txt('২. প্রতিষ্ঠান ও ব্র্যান্ডিং', '2. Business & branding') }}
          </button>
          <button
            (click)="activeTab.set('display')"
            [class]="activeTab() === 'display' ? 'border-b-2 border-teal-600 text-teal-800 py-3 font-bold' : 'text-slate-600 hover:text-slate-900 py-3'"
          >
            {{ prefs.txt('৩. ডিসপ্লে ও সমন্বয়', '3. Display & adjustment') }}
          </button>
          <button
            (click)="activeTab.set('terms')"
            [class]="activeTab() === 'terms' ? 'border-b-2 border-teal-600 text-teal-800 py-3 font-bold' : 'text-slate-600 hover:text-slate-900 py-3'"
          >
            {{ prefs.txt('৪. শর্তাবলি ও স্বাক্ষর', '4. Terms & signature') }}
          </button>
        </div>

        <!-- Form Body -->
        <div class="p-5 overflow-y-auto space-y-4 text-xs text-slate-800">
          
          <!-- TAB: SECTIONS (show / hide) -->
          @if (activeTab() === 'sections') {
            <div class="space-y-3">
              <p class="text-[11px] text-slate-500">{{ prefs.txt('ভাউচারের কোন অংশ দেখাবে আর কোনটা লুকাবে — এই টগলগুলো সব ভাউচারে (বিক্রয় ইনভয়েস, ক্রয়, ডেবিট/ক্রেডিট নোট) প্রযোজ্য।', 'Choose which parts appear on the voucher — these toggles apply to all vouchers (sales invoice, purchase, debit/credit note).') }}</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('লোগো', 'Logo') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showLogo" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('ফাইনাল সামারি', 'Final summary') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showSummary" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('পুরাতন ব্যাটারি জমা', 'Old battery credit') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showOldBatteries" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('ফেরত মাল জমা', 'Returned goods') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showReturnedGoods" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('নোট / রেফারেন্স', 'Notes / reference') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showNotes" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('শুভেচ্ছা বার্তা', 'Greeting text') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showGreeting" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('শর্তাবলি', 'Terms') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showTerms" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('স্বাক্ষরের ছবি', 'Signature image') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showSignatureImage" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
                @if (voucherType() !== 'purchase') {
                  <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                    <span class="font-bold text-slate-800">{{ prefs.txt('QR কোড', 'QR code') }}</span>
                    <input type="checkbox" [(ngModel)]="formSettings.showQRCode" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                  </label>
                }
                <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                  <span class="font-bold text-slate-800">{{ prefs.txt('জলছাপ', 'Watermark') }}</span>
                  <input type="checkbox" [(ngModel)]="formSettings.showWatermark" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                </label>
              </div>

              @if (voucherType() !== 'purchase') {
                <div class="pt-2 border-t border-dashed border-slate-200">
                  <p class="font-bold text-slate-700 mb-1.5">{{ prefs.txt('শুধু সেল ভাউচারে', 'Sales voucher only') }}</p>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                      <span>
                        <span class="font-bold text-slate-800 block">{{ prefs.txt('পরিশোধ সিল (PAID / বাকি)', 'Payment stamp (PAID / DUE)') }}</span>
                        <span class="text-[10px] text-slate-500">{{ prefs.txt('হেডারে পরিশোধিত / বাকি / অগ্রিম সিল বসবে', 'A PAID / DUE / ADVANCE stamp is printed in the header') }}</span>
                      </span>
                      <input type="checkbox" [(ngModel)]="formSettings.showPaymentStatus" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                    </label>
                    <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                      <span>
                        <span class="font-bold text-slate-800 block">{{ prefs.txt('পণ্যের কোড / ব্র্যান্ড / সিরিয়াল', 'Item code / brand / serial') }}</span>
                        <span class="text-[10px] text-slate-500">{{ prefs.txt('পণ্যের নামের নিচে ছোট করে দেখাবে', 'Printed as a small line under the item name') }}</span>
                      </span>
                      <input type="checkbox" [(ngModel)]="formSettings.showItemCode" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                    </label>
                    <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                      <span>
                        <span class="font-bold text-slate-800 block">{{ prefs.txt('কপি লেবেল', 'Copy labels') }}</span>
                        <span class="text-[10px] text-slate-500">{{ prefs.txt('গ্রাহক কপি / অফিস কপি / হিসাব কপি', 'Customer / Office / Accounts copy') }}</span>
                      </span>
                      <input type="checkbox" [(ngModel)]="formSettings.showCopyLabels" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                    </label>
                    <label class="flex items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-teal-50/40">
                      <span>
                        <span class="font-bold text-slate-800 block">{{ prefs.txt('কথায় টাকার পরিমাণ', 'Amount in words') }}</span>
                        <span class="text-[10px] text-slate-500">{{ prefs.txt('মোট টাকার নিচে কথায় লেখা হবে', 'The total is also written out in words') }}</span>
                      </span>
                      <input type="checkbox" [(ngModel)]="formSettings.showAmountInWords" class="w-5 h-5 accent-teal-600 cursor-pointer" />
                    </label>
                  </div>
                </div>
              }
            </div>
          }

          <!-- TAB 2: BRANDING -->
          @if (activeTab() === 'branding') {
            <div class="space-y-3">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('প্রতিষ্ঠানের নাম ১ম অংশ (যেমন: SM)', 'Business name part 1 (e.g. SM)') }}</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      [(ngModel)]="formSettings.businessNamePart1"
                      class="w-full border border-slate-300 rounded-lg p-2 font-bold focus:border-teal-500 focus:outline-none"
                    />
                    <input
                      type="color"
                      [(ngModel)]="formSettings.businessColor1"
                      [title]="prefs.txt('১ম অংশের রঙ', 'Colour of part 1')"
                      class="w-9 h-9 rounded border border-slate-300 cursor-pointer p-0.5 shrink-0"
                    />
                  </div>
                </div>

                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('প্রতিষ্ঠানের নাম ২য় অংশ (যেমন: ENTERPRISE)', 'Business name part 2 (e.g. ENTERPRISE)') }}</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      [(ngModel)]="formSettings.businessNamePart2"
                      class="w-full border border-slate-300 rounded-lg p-2 font-bold focus:border-teal-500 focus:outline-none"
                    />
                    <input
                      type="color"
                      [(ngModel)]="formSettings.businessColor2"
                      [title]="prefs.txt('২য় অংশের রঙ', 'Colour of part 2')"
                      class="w-9 h-9 rounded border border-slate-300 cursor-pointer p-0.5 shrink-0"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('ঠিকানা', 'Address') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formSettings.address"
                  placeholder="{{ prefs.txt('যেমন: ফুলবাড়িগেট-৯২০৩, খুলনা, বাংলাদেশ', 'e.g. Fulbarigate-9203, Khulna, Bangladesh') }}"
                  class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('মোবাইল নম্বর', 'Mobile number') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="formSettings.mobile"
                    class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('ইমেইল', 'Email') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="formSettings.email"
                    class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('বিক্রেতা/প্রস্তুতকারক', 'Sold by') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="formSettings.soldBy"
                    class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('VAT / BIN নম্বর', 'VAT / BIN number') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="formSettings.vatRegNo"
                    class="w-full border border-slate-300 rounded-lg p-2 font-mono font-semibold focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('ট্রেড লাইসেন্স নম্বর', 'Trade license number') }}</label>
                  <input
                    type="text"
                    [(ngModel)]="formSettings.tradeLicenseNo"
                    class="w-full border border-slate-300 rounded-lg p-2 font-mono font-semibold focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>
              <p class="text-[10px] text-slate-500">{{ prefs.txt('মোবাইল, ইমেইল, VAT/BIN ও ট্রেড লাইসেন্স ভাউচারের হেডারে ছাপা হয় — খালি রাখলে ওই লাইন বাদ যায়।', 'Mobile, email, VAT/BIN and trade licence are printed in the voucher header — empty fields are skipped.') }}</p>
            </div>
          }
          <!-- TAB 3: DISPLAY & ADJUSTMENT -->
          @if (activeTab() === 'display') {
            <div class="space-y-4">
              
              <!-- Watermark control -->
              <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div class="flex items-center justify-between">
                  <div>
                    <span class="font-bold text-slate-900 block">{{ prefs.txt('জলছাপ / ব্যাকগ্রাউন্ড ওয়াটারমার্ক', 'Watermark / background') }}</span>
                    <span class="text-[11px] text-slate-500">{{ prefs.txt('ভাউচারের মাঝখানে জলছাপ হিসেবে নাম প্রদর্শিত হবে', 'The name is printed as a watermark in the middle of the voucher') }}</span>
                  </div>
                  <input
                    type="checkbox"
                    [(ngModel)]="formSettings.showWatermark"
                    class="w-5 h-5 accent-teal-600 rounded cursor-pointer"
                  />
                </div>
                @if (formSettings.showWatermark) {
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div class="space-y-1">
                      <label class="block text-[11px] font-semibold text-slate-600">{{ prefs.txt('ওয়াটারমার্ক লেখা', 'Watermark text') }}</label>
                      <input
                        type="text"
                        [(ngModel)]="formSettings.watermarkText"
                        class="w-full border border-slate-300 rounded-lg p-1.5 font-bold uppercase focus:border-teal-500 focus:outline-none"
                      />
                    </div>
                    <div class="space-y-1">
                      <div class="flex justify-between items-center">
                        <label class="text-[11px] font-semibold text-slate-600">{{ prefs.txt('স্বচ্ছতা', 'Opacity') }}: {{ (formSettings.watermarkOpacity * 100) | number:'1.0-0' }}%</label>
                      </div>
                      <input
                        type="range"
                        min="0.01"
                        max="0.2"
                        step="0.01"
                        [(ngModel)]="formSettings.watermarkOpacity"
                        class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                      />
                    </div>
                    <div class="space-y-1">
                      <div class="flex justify-between items-center">
                        <label class="text-[11px] font-semibold text-slate-600">{{ prefs.txt('অ্যাঙ্গেল', 'Rotation') }}: {{ formSettings.watermarkRotation }}°</label>
                      </div>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        step="5"
                        [(ngModel)]="formSettings.watermarkRotation"
                        class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                      />
                    </div>
                  </div>
                }
              </div>

              <!-- QR Code (sales invoice & return notes only) -->
              @if (voucherType() !== 'purchase') {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span class="font-bold text-slate-900 block">{{ prefs.txt('QR কোড প্রদর্শন', 'Show QR code') }}</span>
                      <span class="text-[11px] text-slate-500">{{ prefs.txt('লিংক QR বা টেক্সট QR — নিচে বেছে নিন', 'Link QR or text QR — choose below') }}</span>
                    </div>
                    <input
                      type="checkbox"
                      [(ngModel)]="formSettings.showQRCode"
                      class="w-5 h-5 accent-teal-600 rounded cursor-pointer"
                    />
                  </div>
                  @if (formSettings.showQRCode) {
                    <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('QR কোড সাইজ', 'QR code size') }}: {{ formSettings.qrSize }}px</label>
                      <div class="flex items-center gap-2">
                        <span class="text-[11px] text-slate-400">{{ prefs.txt('ছোট', 'Small') }}</span>
                        <input
                          type="range"
                          min="50"
                          max="200"
                          step="5"
                          [(ngModel)]="formSettings.qrSize"
                          class="w-full accent-teal-600 cursor-pointer"
                        />
                        <span class="text-[11px] text-slate-400">{{ prefs.txt('বড়', 'Large') }}</span>
                      </div>
                    </div>
                  }
                  <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl sm:col-span-2 space-y-2">
                    <div>
                      <span class="font-bold text-slate-900 block">{{ prefs.txt('QR-এ কী থাকবে', 'What the QR carries') }}</span>
                      <span class="text-[11px] text-slate-500">
                        {{ prefs.txt('কোনো QR-ই অ্যাপ ছাড়া পড়া যায় — লিংক QR স্ক্যানে পূর্ণ ভাউচার অনলাইনে খোলে, টেক্সট QR ইন্টারনেট ছাড়াই বিলের সারসংক্ষেপ দেখায়।', 'Any QR reads without the app — a link QR opens the full voucher online, a text QR shows the bill summary without internet.') }}
                      </span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        (click)="formSettings.qrMode = 'link'"
                        [class]="formSettings.qrMode === 'text' ? 'rounded-lg border border-slate-300 bg-white text-slate-600 px-3 py-2 text-left hover:bg-slate-50 cursor-pointer' : 'rounded-lg border-2 border-teal-600 bg-teal-50 text-teal-800 px-3 py-2 text-left cursor-pointer'"
                      >
                        <span class="block font-bold">{{ prefs.txt('লিংক QR', 'Link QR') }}</span>
                        <span class="block text-[10px] opacity-75">{{ prefs.txt('স্ক্যানে অনলাইনে পূর্ণ ভাউচার', 'Scans to the full voucher online') }}</span>
                      </button>
                      <button
                        type="button"
                        (click)="formSettings.qrMode = 'text'"
                        [class]="formSettings.qrMode === 'text' ? 'rounded-lg border-2 border-teal-600 bg-teal-50 text-teal-800 px-3 py-2 text-left cursor-pointer' : 'rounded-lg border border-slate-300 bg-white text-slate-600 px-3 py-2 text-left hover:bg-slate-50 cursor-pointer'"
                      >
                        <span class="block font-bold">{{ prefs.txt('টেক্সট QR', 'Text QR') }}</span>
                        <span class="block text-[10px] opacity-75">{{ prefs.txt('ইন্টারনেট ছাড়াই বিলের সারসংক্ষেপ', 'Bill summary without internet') }}</span>
                      </button>
                    </div>
                    @if (formSettings.qrMode === 'text') {
                      <p class="text-[10px] text-slate-500 leading-relaxed">
                        {{ prefs.txt('টেক্সট QR A4 ভাউচার, POS রশিদ ও ডেবিট নোটে প্রযোজ্য। বড় বিলে প্রথম কয়েকটি আইটেমের পর “+N more” দেখাবে; QR সাইজ বড় করলে স্ক্যান করা সহজ হয়।', 'The text QR applies to the A4 voucher, POS receipts and debit notes. Long bills show a few items then “+N more”; a larger QR size scans more easily.') }}
                      </p>
                    }
                  </div>
                  <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span class="font-bold text-slate-900 block">{{ prefs.txt('POS রশিদে QR', 'QR on POS receipt') }}</span>
                      <span class="text-[11px] text-slate-500">{{ prefs.txt('POS রশিদ ও POS ইনভয়েস স্লিপের QR আলাদাভাবে চালু/বন্ধ', 'Turns the QR on POS receipts and POS invoice slips on or off') }}</span>
                    </div>
                    <input
                      type="checkbox"
                      [(ngModel)]="formSettings.showPosQrCode"
                      class="w-5 h-5 accent-teal-600 rounded cursor-pointer"
                    />
                  </div>
                </div>
              }

              <!-- Colors & Font -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('থিম ও অ্যাকসেন্ট কালার', 'Theme & accent colour') }}</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      [(ngModel)]="formSettings.accentColor"
                      class="w-10 h-10 rounded border border-slate-300 cursor-pointer p-0.5 shrink-0"
                    />
                    <input
                      type="text"
                      [(ngModel)]="formSettings.accentColor"
                      class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('ভাউচারের মূল ফন্ট', 'Voucher font family') }}</label>
                  <select
                    [(ngModel)]="formSettings.fontFamily"
                    class="w-full border border-slate-300 rounded-lg p-2 font-bold focus:border-teal-500 focus:outline-none"
                  >
                    <option value="Kalpurush">{{ prefs.txt('কালপুরুষ (আদর্শ বাংলা ফন্ট)', 'Kalpurush (standard Bangla font)') }}</option>
                    <option value="Calibri">{{ prefs.txt('ক্যালিব্রি (ইংরেজি)', 'Calibri (English)') }}</option>
                  </select>
                </div>
              </div>

              <div class="space-y-2">
                <label class="block font-bold text-slate-700">{{ prefs.txt('প্রিন্ট পেপার ও লেআউট', 'Print paper & layout') }}</label>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{{ prefs.txt('পেপার', 'Paper') }}</span>
                    <select
                      [(ngModel)]="formSettings.paperSize"
                      class="w-full border border-slate-300 rounded-lg p-2 font-bold focus:border-teal-500 focus:outline-none"
                    >
                      <option value="A4">A4 — 210 × 297 mm</option>
                      <option value="A5">{{ prefs.txt('হাফ A4 (A5)', 'Half A4 (A5)') }} — 148 × 210 mm</option>
                      <option value="Custom">{{ prefs.txt('কাস্টম পেপার…', 'Custom paper…') }}</option>
                    </select>
                  </div>

                  <div>
                    <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{{ prefs.txt('ওরিয়েন্টেশন', 'Orientation') }}</span>
                    <div class="flex rounded-lg overflow-hidden border border-slate-300">
                      <button
                        type="button"
                        (click)="formSettings.printOrientation = 'portrait'"
                        [class]="formSettings.printOrientation === 'portrait' ? 'flex-1 py-2 font-bold bg-teal-700 text-white' : 'flex-1 py-2 font-bold bg-white text-slate-600 hover:bg-slate-50'"
                      >{{ prefs.txt('পোর্ট্রেট', 'Portrait') }}</button>
                      <button
                        type="button"
                        (click)="formSettings.printOrientation = 'landscape'"
                        [class]="formSettings.printOrientation === 'landscape' ? 'flex-1 py-2 font-bold bg-teal-700 text-white' : 'flex-1 py-2 font-bold bg-white text-slate-600 hover:bg-slate-50'"
                      >{{ prefs.txt('ল্যান্ডস্কেপ', 'Landscape') }}</button>
                    </div>
                  </div>
                </div>

                @if (formSettings.paperSize === 'Custom') {
                  <div class="grid grid-cols-2 gap-2">
                    <label class="block">
                      <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{{ prefs.txt('প্রস্থ (মিমি)', 'Width (mm)') }}</span>
                      <input
                        type="number"
                        min="60"
                        max="600"
                        [(ngModel)]="formSettings.customPaperWidthMm"
                        class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold focus:border-teal-500 focus:outline-none"
                      />
                    </label>
                    <label class="block">
                      <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{{ prefs.txt('উচ্চতা (মিমি)', 'Height (mm)') }}</span>
                      <input
                        type="number"
                        min="60"
                        max="600"
                        [(ngModel)]="formSettings.customPaperHeightMm"
                        class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold focus:border-teal-500 focus:outline-none"
                      />
                    </label>
                  </div>
                }

                <div>
                  <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{{ prefs.txt('প্রতি পেজে ভাউচার', 'Vouchers per page') }}</span>
                  <div class="grid grid-cols-3 gap-2">
                    @for (count of [1, 2, 4]; track count) {
                      <button
                        type="button"
                        (click)="setCopiesPerPage(count)"
                        [class]="formSettings.copiesPerPage === count ? 'rounded-lg border-2 border-teal-600 bg-teal-50 text-teal-800 py-2 font-bold' : 'rounded-lg border border-slate-300 bg-white text-slate-600 py-2 font-bold hover:bg-slate-50'"
                      >
                        {{ count }} {{ prefs.txt('কপি', 'copy') }}
                        <span class="block text-[9px] font-semibold opacity-70">{{ count === 1 ? prefs.txt('পুরো পেজ', 'Full page') : (count === 2 ? prefs.txt('২-আপ', '2-up') : prefs.txt('২ × ২ গ্রিড', '2 × 2 grid')) }}</span>
                      </button>
                    }
                  </div>
                </div>

                <label class="block">
                  <span class="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{{ prefs.txt('প্রিন্ট মার্জিন (মিমি)', 'Print margin (mm)') }}</span>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    step="1"
                    [(ngModel)]="formSettings.pageMarginMm"
                    class="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold focus:border-teal-500 focus:outline-none"
                  />
                  <span class="block text-[10px] text-slate-500 mt-1">{{ prefs.txt('কাগজের চার পাশে সাদা বর্ডার (০–৩০ মিমি)। ভাউচার ডিজাইন এই ভেতরের জায়গা অনুযায়ী রেসপন্সিভভাবে সাজবে — প্রিভিউ, প্রিন্ট ও PDF সবখানে একই মার্জিন।', 'White border inside every paper edge (0–30 mm). The voucher design reflows into this box, so preview, print and PDF share the same margin.') }}</span>
                </label>

                <p class="text-[10px] text-slate-500 leading-relaxed">{{ printLayoutHint() }}</p>
              </div>

            </div>
          }

          <!-- TAB 4: TERMS & SIGNATURE -->
          @if (activeTab() === 'terms') {
            <div class="space-y-3">
              <div>
                <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('ভাউচারের ধরন (যে ভাউচারের শর্ত সম্পাদনা করবেন)', 'Voucher type (whose terms you are editing)') }}</label>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  @for (option of termsTargetOptions; track option) {
                    <button
                      type="button"
                      (click)="chooseTermsTarget(option)"
                      [class]="termsTarget() === option ? 'rounded-lg border-2 border-teal-600 bg-teal-50 text-teal-800 py-2 text-xs font-bold cursor-pointer' : 'rounded-lg border border-slate-300 bg-white text-slate-600 py-2 text-xs font-bold hover:bg-slate-50 cursor-pointer'"
                    >{{ termsTargetLabel(option) }}</button>
                  }
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('শুভেচ্ছা বার্তা', 'Greeting text') }}</label>
                <input
                  type="text"
                  [ngModel]="termsValue('greeting')"
                  (ngModelChange)="setTermsValue('greeting', $event)"
                  placeholder="{{ prefs.txt('যেমন: ধন্যবাদ, আবার আসবেন!', 'e.g. Thank you, please come again!') }}"
                  class="w-full border border-slate-300 rounded-lg p-2 font-bold text-teal-800 focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('ডিফল্ট নোট', 'Default note') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formSettings.notesText"
                  class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('ওয়ারেন্টি নোট', 'Warranty note') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formSettings.warrantyNote"
                  placeholder="{{ prefs.txt('ভাউচারের ওয়ারেন্টি অংশে ছাপা হবে — খালি রাখলে দেখাবে না', 'Printed under the warranty block on the voucher — leave empty to hide') }}"
                  class="w-full border border-slate-300 rounded-lg p-2 font-semibold focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('শর্ত ১', 'Term 1') }}</label>
                  <input
                    type="text"
                    [ngModel]="termsValue('term1')"
                    (ngModelChange)="setTermsValue('term1', $event)"
                    class="w-full border border-slate-300 rounded-lg p-2 text-xs focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('শর্ত ২', 'Term 2') }}</label>
                  <input
                    type="text"
                    [ngModel]="termsValue('term2')"
                    (ngModelChange)="setTermsValue('term2', $event)"
                    class="w-full border border-slate-300 rounded-lg p-2 text-xs focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('শর্তাবলির ফন্ট সাইজ', 'Terms font size') }}: {{ formSettings.termsFontSize }}px</label>
                <div class="flex items-center gap-2">
                  <span class="text-[11px] text-slate-400">{{ prefs.txt('ছোট', 'Small') }}</span>
                  <input
                    type="range"
                    min="8"
                    max="18"
                    step="1"
                    [(ngModel)]="formSettings.termsFontSize"
                    class="w-full accent-teal-600 cursor-pointer"
                  />
                  <span class="text-[11px] text-slate-400">{{ prefs.txt('বড়', 'Large') }}</span>
                </div>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('স্বাক্ষরের বিবরণ', 'Signature label') }}</label>
                <input
                  type="text"
                  [(ngModel)]="formSettings.signatureTitle"
                  class="w-full border border-slate-300 rounded-lg p-2 font-bold focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div>
                  <span class="font-bold text-slate-900 block">{{ prefs.txt('অনুমোদিত স্বাক্ষরের ছবি', 'Authorised signature image') }}</span>
                  <span class="text-[11px] text-slate-500">{{ prefs.txt('স্বচ্ছ PNG ছবি সবচেয়ে ভালো; ছবি স্বয়ংক্রিয়ভাবে ছোট করে সেভ হবে।', 'A transparent PNG works best; the image is saved automatically in a smaller size.') }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  @if (formSettings.signatureImage) {
                    <img
                      [src]="formSettings.signatureImage"
                      alt="{{ prefs.txt('অনুমোদিত স্বাক্ষরের প্রিভিউ', 'Authorized signature preview') }}"
                      class="h-12 w-32 object-contain bg-white border border-slate-300 rounded-lg p-1"
                    />
                    <button
                      (click)="removeSignatureImage()"
                      class="text-rose-600 hover:text-rose-800 font-bold px-3 py-1.5 rounded-lg border border-rose-300 hover:bg-rose-50 cursor-pointer"
                    >
                      {{ prefs.txt('ছবি মুছুন', 'Remove image') }}
                    </button>
                  } @else {
                    <span class="text-[11px] text-slate-400 italic">{{ prefs.txt('কোনো ছবি দেওয়া হয়নি', 'No image provided') }}</span>
                  }
                  <label class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-3 py-1.5 rounded-lg cursor-pointer inline-flex items-center gap-1">
                    <mat-icon class="text-sm">upload</mat-icon> {{ prefs.txt('ছবি আপলোড', 'Upload image') }}
                    <input type="file" accept="image/*" class="hidden" (change)="onSignatureUpload($event)" />
                  </label>
                </div>
              </div>
            </div>
          }

        </div>

        <!-- Footer Buttons -->
        <div class="bg-slate-100 px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <button
            (click)="resetDefaults()"
            class="text-rose-600 hover:text-rose-800 font-bold px-3 py-1.5 rounded-lg border border-rose-300 hover:bg-rose-50 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <mat-icon class="text-xs">restart_alt</mat-icon> {{ prefs.txt('রিসেট ডিফল্ট', 'Reset defaults') }}
          </button>

          <div class="flex items-center gap-2">
            <button
              (click)="closeModal.emit()"
              class="border border-slate-300 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              {{ prefs.txt('বাতিল', 'Cancel') }}
            </button>
            <button
              (click)="saveSettings()"
              class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-6 py-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <mat-icon class="text-sm">check</mat-icon> {{ prefs.txt('সেটিংস সংরক্ষণ করুন', 'Save settings') }}
            </button>
          </div>
        </div>

      </div>

    </div>
  `
})
export class VoucherSettingsModal {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  private media = inject(MediaService);
  private cdr = inject(ChangeDetectorRef);
  readonly prefs = inject(PreferencesService);
  closeModal = output<void>();

  activeTab = signal<'branding' | 'display' | 'sections' | 'terms'>('branding');

  formSettings: VoucherSettings = { ...this.dataService.voucherSettings() };

  voucherType = input<TermsTarget>('sale');

  readonly termsTargetOptions: TermsTarget[] = ['sale', 'purchase', 'credit', 'debit'];

  termsTargetLabel(target: TermsTarget): string {
    if (target === 'purchase') return this.prefs.txt('ক্রয় ভাউচার', 'Purchase voucher');
    if (target === 'credit') return this.prefs.txt('ক্রেডিট নোট', 'Credit note');
    if (target === 'debit') return this.prefs.txt('ডেবিট নোট', 'Debit note');
    return this.prefs.txt('বিক্রয় ভাউচার', 'Sales voucher');
  }

  private readonly pickedTermsTarget = signal<TermsTarget | null>(null);
  readonly termsTarget = computed(() => this.pickedTermsTarget() ?? this.voucherType());

  private readonly termsFields: Record<TermsTarget, Record<TermsField, TermsKey>> = {
    sale: { greeting: 'greetingText', term1: 'term1', term2: 'term2' },
    purchase: { greeting: 'purchaseGreeting', term1: 'purchaseTerm1', term2: 'purchaseTerm2' },
    credit: { greeting: 'creditGreeting', term1: 'creditTerm1', term2: 'creditTerm2' },
    debit: { greeting: 'debitGreeting', term1: 'debitTerm1', term2: 'debitTerm2' },
  };

  chooseTermsTarget(target: TermsTarget) {
    this.pickedTermsTarget.set(target);
  }

  termsValue(field: TermsField): string {
    return this.formSettings[this.termsFields[this.termsTarget()][field]];
  }

  setTermsValue(field: TermsField, value: string) {
    this.formSettings[this.termsFields[this.termsTarget()][field]] = value;
  }

  async onSignatureUpload(event: Event) {
    const picked = await this.media.pick(event, 'signature', 'signature', 5, SIGNATURE_LIMITS);
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, this.prefs.txt('ছবি', 'Image'));
      return;
    }
    this.formSettings.signatureImage = picked.image.ref;
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
    this.cdr.detectChanges();
  }

  removeSignatureImage() {
    this.formSettings.signatureImage = '';
  }

  setCopiesPerPage(count: number) {
    this.formSettings.copiesPerPage = count === 4 ? 4 : count === 2 ? 2 : 1;
  }

  printLayoutHint(): string {
    const paper = this.formSettings.paperSize === 'A5'
      ? 'A5 (148 × 210 mm)'
      : this.formSettings.paperSize === 'Custom'
        ? `${this.prefs.txt('কাস্টম', 'Custom')} (${this.formSettings.customPaperWidthMm || 210} × ${this.formSettings.customPaperHeightMm || 297} mm)`
        : 'A4 (210 × 297 mm)';
    const orientation = this.formSettings.printOrientation === 'landscape'
      ? this.prefs.txt('ল্যান্ডস্কেপ', 'Landscape')
      : this.prefs.txt('পোর্ট্রেট', 'Portrait');
    const copies = this.formSettings.copiesPerPage || 1;
    const marginMm = Math.min(30, Math.max(0, Number(this.formSettings.pageMarginMm) || 0));
    const margin = this.prefs.txt(`মার্জিন ${marginMm} মিমি`, `margin ${marginMm} mm`);

    if (copies === 1) {
      return this.formSettings.printOrientation === 'landscape'
        ? this.prefs.txt(`${paper} · ${orientation} · ${margin} — প্রতি পেজে ১টি ভাউচার, পেজের উপরে ল্যান্ডস্কেপ আকারে বসবে।`, `${paper} · ${orientation} · ${margin} — one voucher per page, placed landscape at the top of the page.`)
        : this.prefs.txt(`${paper} · ${orientation} · ${margin} — প্রতি পেজে ১টি ভাউচার।`, `${paper} · ${orientation} · ${margin} — one voucher per page.`);
    }
    if (copies === 2) {
      return this.prefs.txt(`${paper} · ${orientation} · ${margin} — প্রতি পেজে ২টি ভাউচার (2-up)।`, `${paper} · ${orientation} · ${margin} — two vouchers per page (2-up).`);
    }
    return this.prefs.txt(`${paper} · ${orientation} · ${margin} — এক পেজে ৪টি ভাউচার (২×২), কাটিং গাইড লাইন সহ।`, `${paper} · ${orientation} · ${margin} — four vouchers per page (2 × 2) with cutting guide lines.`);
  }

  saveSettings() {
    this.formSettings.customPaperWidthMm = Math.min(600, Math.max(60, Number(this.formSettings.customPaperWidthMm) || 210));
    this.formSettings.customPaperHeightMm = Math.min(600, Math.max(60, Number(this.formSettings.customPaperHeightMm) || 297));
    const marginMm = Number(this.formSettings.pageMarginMm);
    this.formSettings.pageMarginMm = Number.isFinite(marginMm) ? Math.min(30, Math.max(0, marginMm)) : 9;
    this.dataService.updateVoucherSettings(this.formSettings);
    this.notify.success(this.prefs.txt('ভাউচার সেটিংস সফলভাবে আপডেট ও সংরক্ষিত হয়েছে।', 'Voucher settings were updated and saved successfully.'));
    this.closeModal.emit();
  }

  async resetDefaults() {
    const confirmed = await this.notify.confirm(this.prefs.txt('সব কাস্টম সেটিং মুছে গিয়ে আসল ডিফল্ট সেটিংস ফিরে আসবে।', 'All custom settings will be removed and the original defaults restored.'), {
      title: this.prefs.txt('ডিফল্টে ফিরিয়ে নেবেন?', 'Restore defaults?'),
      kind: 'warning',
      confirmText: this.prefs.txt('ডিফল্ট করুন', 'Restore'),
      cancelText: this.prefs.txt('বাতিল', 'Cancel')
    });
    if (confirmed) {
      this.dataService.resetVoucherSettings();
      this.formSettings = { ...this.dataService.voucherSettings() };
      this.notify.success(this.prefs.txt('ভাউচার সেটিংস পুনরায় ডিফল্ট অবস্থায় সেট করা হয়েছে।', 'Voucher settings were reset to their defaults.'));
      this.closeModal.emit();
    }
  }
}
