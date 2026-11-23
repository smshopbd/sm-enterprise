import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, WarrantySettings } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';

type ListKey = 'receiptStatuses' | 'replacementStatuses' | 'conditions' | 'dispositions';
type RuleKey = 'requireInvoice' | 'requireSerial' | 'allowMainStockReplacement' | 'allowNegativeStock' | 'autoSettleReceipt';
type SettingsDraft = Omit<WarrantySettings, ListKey | 'startNumber' | 'defaultWarrantyDays'> & Record<ListKey, string> & {
  startNumber: number | null;
  defaultWarrantyDays: number | null;
};

@Component({
  selector: 'app-warranty-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule],
  template: `
    <div class="space-y-4 text-xs text-slate-800 dark:text-slate-200">
      <header class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">tune</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                {{ prefs.txt('ওয়ারেন্টি', 'Warranty') }}
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                {{ prefs.txt('সেটিংস', 'Settings') }}
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('ওয়ারেন্টি সিস্টেম সেটিংস', 'Warranty System Settings') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('ক্লেইম নম্বর, ওয়ারেন্টির নিয়ম, তালিকা ও প্রিন্টের লেখা ঠিক করুন। এটি অ্যাপের পারমিশন সেটিংস নয়।', 'Customize claim numbering, warranty rules, lists and printed text. These are not app permission settings.') }}</p>
            </div>
          </div>
          <span class="shrink-0 self-start sm:self-center rounded-lg px-2.5 py-1 text-[10px] font-bold ring-1 backdrop-blur-sm"
            [class]="dirty()
              ? 'bg-amber-400/20 text-amber-50 ring-amber-200/40'
              : 'bg-white/10 text-teal-50 ring-white/20'" role="status">{{ dirty() ? prefs.txt('সংরক্ষণ না করা পরিবর্তন আছে', 'Unsaved changes') : prefs.txt('সংরক্ষিত সেটিংস', 'Saved settings') }}</span>
        </div>
      </header>

      @if (!isAdmin()) {
        <p role="status" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-amber-800 dark:text-amber-300">
          {{ prefs.txt('শুধু সক্রিয় Admin এই সেটিংস সংরক্ষণ বা ডিফল্টে ফিরিয়ে নিতে পারেন। আপনি শুধু দেখতে পারবেন।', 'Only an active Admin can save or reset these settings. This page is read-only for you.') }}
        </p>
      }
      @if (savedChanged() && dirty()) {
        <div role="alert" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-amber-800 dark:text-amber-300">
          {{ prefs.txt('অন্যত্র সংরক্ষিত সেটিংস বদলেছে। আপনার অসম্পূর্ণ সম্পাদনা অক্ষত আছে। নতুন সেটিংস লোড করে আবার সম্পাদনা করুন।', 'Saved settings changed elsewhere. Your edits have been preserved. Load the latest settings before editing again.') }}
          <button type="button" (click)="discardChanges()" [disabled]="busy()" class="ml-2 font-bold underline cursor-pointer">{{ prefs.txt('সংরক্ষিত সেটিংস লোড করুন', 'Load saved settings') }}</button>
        </div>
      }

      <form (ngSubmit)="save()" novalidate class="space-y-4">
        <fieldset [disabled]="!canEdit()" class="space-y-4 min-w-0">
          <section class="panel overflow-hidden" aria-labelledby="wsettings-numbering">
            <h2 id="wsettings-numbering" class="section-heading"><mat-icon class="text-teal-600">tag</mat-icon>{{ prefs.txt('নম্বর ও ডিফল্ট মেয়াদ', 'Numbering & Default Period') }}</h2>
            <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label class="block">
                <span class="app-label">{{ prefs.txt('গ্রহণ নম্বরের প্রিফিক্স', 'Receipt prefix') }} *</span>
                <input name="receiptPrefix" [ngModel]="draft().receiptPrefix" (ngModelChange)="set('receiptPrefix', $event)" maxlength="16" class="app-input font-mono" required />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('পরিবর্তন নম্বরের প্রিফিক্স', 'Replacement prefix') }} *</span>
                <input name="replacementPrefix" [ngModel]="draft().replacementPrefix" (ngModelChange)="set('replacementPrefix', $event)" maxlength="16" class="app-input font-mono" required />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('শুরুর নম্বর', 'Starting number') }} *</span>
                <input name="startNumber" type="number" min="1" step="1" [ngModel]="draft().startNumber" (ngModelChange)="set('startNumber', $event)" class="app-input font-mono" required />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('ডিফল্ট ওয়ারেন্টি (দিন)', 'Default warranty (days)') }} *</span>
                <input name="defaultWarrantyDays" type="number" min="0" step="1" [ngModel]="draft().defaultWarrantyDays" (ngModelChange)="set('defaultWarrantyDays', $event)" class="app-input font-mono" required />
              </label>
              <p class="sm:col-span-2 lg:col-span-4 text-[11px] text-slate-500 dark:text-slate-400">
                {{ prefs.txt('দুটি প্রিফিক্স আলাদা হতে হবে: ইংরেজি অক্ষর দিয়ে শুরু, এরপর অক্ষর, সংখ্যা, _ বা -; সর্বোচ্চ ১৬ অক্ষর। শুরুর নম্বর ধনাত্মক পূর্ণসংখ্যা; ডিফল্ট দিন ০ বা বেশি পূর্ণসংখ্যা।', 'Use distinct prefixes: start with an English letter, followed by letters, digits, _ or -, up to 16 characters. Starting number must be a positive integer; default days must be a nonnegative integer.') }}
              </p>
              <p class="sm:col-span-2 lg:col-span-4 text-[11px] text-slate-500 dark:text-slate-400">
                {{ prefs.txt('এগুলো নতুন ডকুমেন্টের জন্য; বিদ্যমান ক্লেইমের নম্বর বা ওয়ারেন্টি মেয়াদ বদলাবে না।', 'These defaults apply to new documents; existing claim numbers and warranty periods are not rewritten.') }}
              </p>
            </div>
          </section>

          <section class="panel overflow-hidden" aria-labelledby="wsettings-lists">
            <h2 id="wsettings-lists" class="section-heading"><mat-icon class="text-teal-600">format_list_bulleted</mat-icon>{{ prefs.txt('অবস্থা, কন্ডিশন ও নিষ্পত্তি', 'Statuses, Conditions & Dispositions') }}</h2>
            <div class="p-4 space-y-3">
              <p class="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 p-3 text-teal-800 dark:text-teal-200">
                {{ prefs.txt('কাস্টম স্ট্যাটাস শুধু প্রদর্শনের লেবেল; এগুলো স্টকের কার্যকরী ধাপ নিয়ন্ত্রণ করে না। লেবেল বদলালে পণ্য গ্রহণ, পরিবর্তন, নিষ্পত্তি বা স্টক স্থানান্তর হয় না—এসব সংশ্লিষ্ট ডকুমেন্ট ও স্টক অ্যাকশন দিয়ে করতে হবে।', 'Custom status labels do not control the operational stock stage. Renaming a label does not receive, replace, dispose of or transfer stock; those operations use the corresponding documents and stock actions.') }}
              </p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">{{ prefs.txt('প্রতি লাইনে একটি মান দিন। খালি লাইন ও একই মানের পুনরাবৃত্তি বাদ যাবে। প্রতিটি তালিকায় অন্তত একটি মান রাখুন। প্রথম স্ট্যাটাস ও কন্ডিশন নতুন ফরমের ডিফল্ট।', 'Enter one value per line. Blank lines and duplicates are removed. Keep at least one value in each list. The first status and condition are defaults for new forms.') }}</p>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                @for (field of listFields; track field.key) {
                  <label class="block">
                    <span class="app-label">{{ prefs.txt(field.bn, field.en) }} *</span>
                    <textarea [name]="field.key" rows="6" [ngModel]="draft()[field.key]" (ngModelChange)="set(field.key, $event)" class="app-input resize-y" required></textarea>
                  </label>
                }
              </div>
              <label class="block md:w-1/2">
                <span class="app-label">{{ prefs.txt('পরিবর্তনের পর গ্রহণের স্ট্যাটাস', 'Receipt status after replacement') }} *</span>
                <select name="receiptReplacedStatus" [ngModel]="draft().receiptReplacedStatus" (ngModelChange)="set('receiptReplacedStatus', $event)" [disabled]="!canEdit()" class="app-input" required>
                  <option value="">{{ prefs.txt('গ্রহণ তালিকা থেকে নির্বাচন করুন', 'Choose from receipt statuses') }}</option>
                  @if (draft().receiptReplacedStatus && !receiptStatusOptions().includes(draft().receiptReplacedStatus)) {
                    <option [ngValue]="draft().receiptReplacedStatus" disabled>{{ draft().receiptReplacedStatus }} — {{ prefs.txt('তালিকায় নেই', 'not in list') }}</option>
                  }
                  @for (status of receiptStatusOptions(); track status) { <option [ngValue]="status">{{ status }}</option> }
                </select>
                <span class="block text-[10px] text-slate-500 dark:text-slate-400 mt-1">{{ prefs.txt('স্বয়ংক্রিয় নিষ্পত্তি চালু থাকলে সংযুক্ত গ্রহণে এই লেবেল বসবে। এটি গ্রহণের স্ট্যাটাস তালিকায় থাকতে হবে।', 'Applied to the linked receipt when auto-settlement is enabled. Must belong to the receipt status list.') }}</span>
              </label>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">{{ prefs.txt('তালিকা সম্পাদনায় পুরোনো ডকুমেন্টের সংরক্ষিত লেবেল পরিবর্তন হবে না।', 'Editing lists does not rewrite labels already stored on existing documents.') }}</p>
            </div>
          </section>

          <section class="panel overflow-hidden" aria-labelledby="wsettings-rules">
            <h2 id="wsettings-rules" class="section-heading"><mat-icon class="text-teal-600">rule</mat-icon>{{ prefs.txt('ওয়ারেন্টির নিয়ম', 'Warranty Rules') }}</h2>
            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              @for (rule of rules; track rule.key) {
                <label class="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
                  <input type="checkbox" [name]="rule.key" [ngModel]="draft()[rule.key]" (ngModelChange)="set(rule.key, $event)" class="h-4 w-4 mt-0.5 shrink-0 accent-teal-600" />
                  <span><strong class="block">{{ prefs.txt(rule.bn, rule.en) }}</strong><span class="block mt-1 text-[11px] text-slate-500 dark:text-slate-400">{{ prefs.txt(rule.helpBn, rule.helpEn) }}</span></span>
                </label>
              }
            </div>
          </section>

          <section class="panel overflow-hidden" aria-labelledby="wsettings-print">
            <h2 id="wsettings-print" class="section-heading"><mat-icon class="text-teal-600">print</mat-icon>{{ prefs.txt('প্রিন্টের লেখা', 'Printed Text') }}</h2>
            <div class="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="block md:col-span-2">
                <span class="app-label">{{ prefs.txt('প্রিন্টের শিরোনাম', 'Print title') }}</span>
                <input name="printTitle" [ngModel]="draft().printTitle" (ngModelChange)="set('printTitle', $event)" class="app-input" />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('ফুটার', 'Footer') }}</span>
                <textarea name="printFooter" rows="4" [ngModel]="draft().printFooter" (ngModelChange)="set('printFooter', $event)" class="app-input resize-y"></textarea>
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('ওয়ারেন্টির শর্তাবলি', 'Warranty terms') }}</span>
                <textarea name="printTerms" rows="4" [ngModel]="draft().printTerms" (ngModelChange)="set('printTerms', $event)" class="app-input resize-y"></textarea>
              </label>
            </div>
          </section>
        </fieldset>

        @if (formError()) { <p role="alert" class="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-rose-700 dark:text-rose-300">{{ formError() }}</p> }
        <footer class="panel p-3 flex flex-wrap justify-between gap-2">
          <button type="button" (click)="reset()" [disabled]="!canEdit()" class="secondary-button text-rose-600 dark:text-rose-400">{{ prefs.txt('ডিফল্টে ফিরিয়ে নিন', 'Reset to Defaults') }}</button>
          <div class="flex flex-wrap gap-2">
            <button type="button" (click)="discardChanges()" [disabled]="busy() || !dirty()" class="secondary-button">{{ prefs.txt('সম্পাদনা বাতিল', 'Discard Edits') }}</button>
            <button type="submit" [disabled]="!canEdit() || !dirty() || savedChanged()" class="primary-button flex items-center gap-1"><mat-icon class="text-sm">save</mat-icon>{{ prefs.txt('সেটিংস সংরক্ষণ', 'Save Settings') }}</button>
          </div>
        </footer>
      </form>
    </div>
  `,
  styles: [`
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
    .section-heading { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .app-label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: #64748b; margin-bottom: 3px; }
    .app-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 7px 9px; font-size: 12px; color: #0f172a; outline: none; }
    .app-input:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,.15); }
    .primary-button, .secondary-button { border-radius: 8px; padding: 7px 12px; font-weight: 700; cursor: pointer; }
    .primary-button { background: #0d9488; color: #fff; border: 1px solid #0d9488; }
    .primary-button:hover { background: #0f766e; }
    .secondary-button { border: 1px solid #cbd5e1; }
    button:disabled, fieldset:disabled input, fieldset:disabled textarea, select:disabled { opacity: .55; cursor: not-allowed; }
    button:focus-visible { outline: 2px solid #0d9488; outline-offset: 3px; }
    :host-context(.dark) .panel { background: #0f172a; border-color: #334155; }
    :host-context(.dark) .section-heading { background: #1e293b; border-color: #334155; }
    :host-context(.dark) .app-label { color: #94a3b8; }
    :host-context(.dark) .app-input { background: #0b1220; border-color: #475569; color: #e2e8f0; }
    :host-context(.dark) .secondary-button { border-color: #475569; }
  `]
})
export class WarrantySettingsPage {
  private readonly data = inject(DataService);
  private readonly notify = inject(NotificationService);
  private readonly session = inject(SessionService);
  readonly prefs = inject(PreferencesService);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly draft = signal<SettingsDraft>(this.toDraft(this.data.warrantySettings()));
  private readonly baseline = signal<SettingsDraft>(this.draft());
  readonly isAdmin = computed(() => {
    const user = this.session.currentUser();
    return user?.role === 'Admin' && user.active;
  });
  readonly canEdit = computed(() => this.isAdmin() && !this.busy());
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.baseline()));
  readonly savedChanged = computed(() => JSON.stringify(this.toDraft(this.data.warrantySettings())) !== JSON.stringify(this.baseline()));
  readonly receiptStatusOptions = computed(() => this.normalizeList(this.draft().receiptStatuses));
  readonly listFields: { key: ListKey; bn: string; en: string }[] = [
    { key: 'receiptStatuses', bn: 'গ্রহণের স্ট্যাটাস', en: 'Receipt statuses' },
    { key: 'replacementStatuses', bn: 'পরিবর্তনের স্ট্যাটাস', en: 'Replacement statuses' },
    { key: 'conditions', bn: 'পণ্যের কন্ডিশন', en: 'Product conditions' },
    { key: 'dispositions', bn: 'ত্রুটিপূর্ণ পণ্যের নিষ্পত্তি', en: 'Faulty unit dispositions' }
  ];
  readonly rules: { key: RuleKey; bn: string; en: string; helpBn: string; helpEn: string }[] = [
    { key: 'requireInvoice', bn: 'ইনভয়েস আবশ্যক', en: 'Require invoice', helpBn: 'ওয়ারেন্টি গ্রহণের সময় ইনভয়েস নম্বর চাইবে।', helpEn: 'Require an invoice number when receiving a warranty claim.' },
    { key: 'requireSerial', bn: 'সিরিয়াল আবশ্যক', en: 'Require serial', helpBn: 'ওয়ারেন্টি ডকুমেন্টে সিরিয়াল / IMEI চাইবে।', helpEn: 'Require a serial number / IMEI on warranty documents.' },
    { key: 'allowMainStockReplacement', bn: 'মূল স্টক থেকে পরিবর্তন অনুমোদন', en: 'Allow main-stock replacement', helpBn: 'পরিবর্তনের উৎস হিসেবে মূল বিক্রয় স্টক নির্বাচন করা যাবে; এটি স্টক দুটি এক করে না।', helpEn: 'Allow main sales stock as a replacement source; this does not merge the warranty pools.' },
    { key: 'allowNegativeStock', bn: 'ঋণাত্মক স্টক অনুমোদন', en: 'Allow negative stock', helpBn: 'উপলব্ধ স্টকের বেশি আউট করা যাবে। সতর্কতার সাথে চালু করুন।', helpEn: 'Permit outgoing quantities beyond available stock. Enable with care.' },
    { key: 'autoSettleReceipt', bn: 'গ্রহণ স্বয়ংক্রিয় নিষ্পত্তি', en: 'Auto-settle receipt', helpBn: 'পরিবর্তনের সাথে সংযুক্ত গ্রহণ নিষ্পত্তি করে নির্বাচিত স্ট্যাটাস বসাবে।', helpEn: 'Settle the linked receipt when a replacement is recorded and apply the selected receipt status.' }
  ];

  constructor() {
    effect(() => {
      const settings = this.data.warrantySettings();
      // Hydration or remote updates may refresh a pristine form, never an edited one.
      untracked(() => { if (!this.dirty()) this.acceptSaved(settings); });
    });
  }

  set<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) {
    if (!this.canEdit()) return;
    this.draft.update(current => ({ ...current, [key]: value }));
    this.formError.set('');
  }

  save() {
    if (this.busy() || !this.requireAdmin()) return;
    if (this.savedChanged()) {
      this.fail(this.prefs.txt('সংরক্ষিত সেটিংস বদলেছে। আগে নতুন সেটিংস লোড করুন।', 'Saved settings have changed. Load the latest settings first.')); return;
    }
    const draft = this.draft();
    const receiptPrefix = draft.receiptPrefix.trim(), replacementPrefix = draft.replacementPrefix.trim();
    const safePrefix = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;
    if (!safePrefix.test(receiptPrefix) || !safePrefix.test(replacementPrefix)) {
      this.fail(this.prefs.txt('বৈধ প্রিফিক্স দিন: ইংরেজি অক্ষর দিয়ে শুরু, সর্বোচ্চ ১৬ অক্ষর; শুধু অক্ষর, সংখ্যা, _ ও -।', 'Enter safe prefixes: start with an English letter, maximum 16 characters; only letters, digits, _ and - are allowed.')); return;
    }
    if (receiptPrefix.toLowerCase() === replacementPrefix.toLowerCase()) {
      this.fail(this.prefs.txt('গ্রহণ ও পরিবর্তনের প্রিফিক্স আলাদা হতে হবে।', 'Receipt and replacement prefixes must be distinct.')); return;
    }
    const startNumber = draft.startNumber, defaultWarrantyDays = draft.defaultWarrantyDays;
    if (typeof startNumber !== 'number' || !Number.isSafeInteger(startNumber) || startNumber <= 0) {
      this.fail(this.prefs.txt('শুরুর নম্বর নিরাপদ সীমার মধ্যে ধনাত্মক পূর্ণসংখ্যা হতে হবে।', 'Starting number must be a positive safe integer.')); return;
    }
    if (typeof defaultWarrantyDays !== 'number' || !Number.isSafeInteger(defaultWarrantyDays) || defaultWarrantyDays < 0) {
      this.fail(this.prefs.txt('ডিফল্ট দিন নিরাপদ সীমার মধ্যে ০ বা বেশি পূর্ণসংখ্যা হতে হবে।', 'Default warranty days must be a nonnegative safe integer.')); return;
    }
    const receiptStatuses = this.normalizeList(draft.receiptStatuses);
    const replacementStatuses = this.normalizeList(draft.replacementStatuses);
    const conditions = this.normalizeList(draft.conditions);
    const dispositions = this.normalizeList(draft.dispositions);
    if (!receiptStatuses.length || !replacementStatuses.length || !conditions.length || !dispositions.length) {
      this.fail(this.prefs.txt('প্রতিটি স্ট্যাটাস, কন্ডিশন ও নিষ্পত্তির তালিকায় অন্তত একটি মান দিন।', 'Each status, condition and disposition list must contain at least one value.')); return;
    }
    const receiptReplacedStatus = draft.receiptReplacedStatus.trim();
    if (!receiptStatuses.includes(receiptReplacedStatus)) {
      this.fail(this.prefs.txt('পরিবর্তনের পরের স্ট্যাটাসটি গ্রহণের স্ট্যাটাস তালিকা থেকে নির্বাচন করুন।', 'Choose the replaced receipt status from the receipt status list.')); return;
    }
    const settings: WarrantySettings = {
      ...draft, receiptPrefix, replacementPrefix, startNumber, defaultWarrantyDays,
      receiptStatuses, replacementStatuses, conditions, dispositions, receiptReplacedStatus,
      printTitle: draft.printTitle.trim(), printFooter: draft.printFooter.trim(), printTerms: draft.printTerms.trim()
    };
    this.busy.set(true);
    try {
      this.data.updateWarrantySettings(settings);
      this.acceptSaved(this.data.warrantySettings());
      this.notify.success(this.prefs.txt('ওয়ারেন্টি সেটিংস সংরক্ষিত হয়েছে।', 'Warranty settings saved.'));
    } catch {
      this.fail(this.prefs.txt('ওয়ারেন্টি সেটিংস সংরক্ষণ করা যায়নি। আপনার সম্পাদনা রাখা হয়েছে।', 'Could not save warranty settings. Your edits have been retained.'));
    } finally {
      this.busy.set(false);
    }
  }

  async reset() {
    if (this.busy() || !this.requireAdmin()) return;
    this.busy.set(true);
    try {
      const confirmed = await this.notify.confirm(
        this.prefs.txt('সব ওয়ারেন্টি সেটিংস ডিফল্টে ফিরিয়ে সংরক্ষণ করবেন? অসম্পূর্ণ সম্পাদনা বাদ যাবে। বিদ্যমান ক্লেইম ও স্টক ইতিহাস মুছবে না।', 'Restore and save all default warranty settings? Unsaved edits will be discarded. Existing claims and stock history will not be deleted.'),
        { title: this.prefs.txt('ওয়ারেন্টি সেটিংস রিসেট', 'Reset Warranty Settings'), confirmText: this.prefs.txt('ডিফল্টে ফিরিয়ে নিন', 'Reset to Defaults'), cancelText: this.prefs.txt('বাতিল', 'Cancel'), kind: 'warning' }
      );
      // A role/session can change while the confirmation is open.
      if (!confirmed || !this.requireAdmin()) return;
      this.data.resetWarrantySettings();
      this.acceptSaved(this.data.warrantySettings());
      this.notify.success(this.prefs.txt('ডিফল্ট ওয়ারেন্টি সেটিংস পুনরুদ্ধার হয়েছে।', 'Default warranty settings restored.'));
    } catch {
      this.fail(this.prefs.txt('ওয়ারেন্টি সেটিংস রিসেট করা যায়নি।', 'Could not reset warranty settings.'));
    } finally {
      this.busy.set(false);
    }
  }

  async discardChanges() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (this.dirty()) {
        const confirmed = await this.notify.confirm(
          this.prefs.txt('অসম্পূর্ণ সম্পাদনা বাদ দিয়ে বর্তমানে সংরক্ষিত সেটিংস লোড করবেন?', 'Discard your unsaved edits and load the currently saved settings?'),
          { title: this.prefs.txt('সম্পাদনা বাতিল', 'Discard Edits'), confirmText: this.prefs.txt('লোড করুন', 'Load'), cancelText: this.prefs.txt('বাতিল', 'Cancel') }
        );
        if (!confirmed) return;
      }
      this.acceptSaved(this.data.warrantySettings());
    } finally {
      this.busy.set(false);
    }
  }

  confirmLeave(): boolean | Promise<boolean> {
    if (this.busy()) return false;
    return !this.dirty() || this.notify.confirm(
      this.prefs.txt('সেভ না করা সেটিংস বাদ দেবেন?', 'Discard unsaved settings?'),
      { title: this.prefs.txt('পরিবর্তন বাদ দিন?', 'Discard changes?') }
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty()) { event.preventDefault(); event.returnValue = ''; }
  }

  private requireAdmin(): boolean {
    if (this.isAdmin()) return true;
    this.fail(this.prefs.txt('শুধু সক্রিয় Admin ওয়ারেন্টি সেটিংস সংরক্ষণ বা রিসেট করতে পারেন।', 'Only an active Admin can save or reset warranty settings.'));
    return false;
  }
  private fail(message: string) { this.formError.set(message); this.notify.error(message); }
  private normalizeList(text: string): string[] {
    const seen = new Set<string>();
    return text.split(/\r?\n/).map(value => value.trim()).filter(value => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  private toDraft(settings: WarrantySettings): SettingsDraft {
    // Text copies keep editing and resets from mutating service/default arrays.
    return {
      ...settings,
      receiptStatuses: settings.receiptStatuses.join('\n'), replacementStatuses: settings.replacementStatuses.join('\n'),
      conditions: settings.conditions.join('\n'), dispositions: settings.dispositions.join('\n')
    };
  }
  private acceptSaved(settings: WarrantySettings) {
    const draft = this.toDraft(settings);
    this.draft.set(draft);
    this.baseline.set(draft);
    this.formError.set('');
  }
}
