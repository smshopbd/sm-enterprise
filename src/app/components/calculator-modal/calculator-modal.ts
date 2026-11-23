import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PreferencesService } from '../../services/preferences';
import { CalcError, evaluateExpression } from '../../utils/calc';
import { formatDec } from '../../utils/decimal';

type Mode = 'basic' | 'scientific' | 'weight' | 'count' | 'percent' | 'age' | 'vat';

interface UnitDef {
  readonly key: string;
  readonly bn: string;
  readonly en: string;
  readonly factor: number; // 1 unit = factor × base (weight base = kg, count base = pcs)
  readonly digits: number;
}

interface BasisDef {
  readonly key: string;
  readonly bn: string;
  readonly en: string;
}

@Component({
  selector: 'app-calculator-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  styles: `
    .calc-key {
      transition: transform 0.08s ease, background-color 0.12s ease, filter 0.12s ease;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .calc-key:active,
    .calc-key.calc-pressed {
      transform: scale(0.94);
      filter: brightness(1.08);
    }
    .mode-scroll { scrollbar-width: none; }
    .mode-scroll::-webkit-scrollbar { display: none; }
    .no-bar { scrollbar-width: none; }
    .no-bar::-webkit-scrollbar { display: none; }
    .tool-input {
      width: 100%;
      border-radius: 0.75rem;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      padding: 0.5rem 0.75rem;
      color: #0f172a;
      font-family: inherit;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .tool-input:focus {
      border-color: #0d9488;
      box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.14);
    }
    .tool-input::placeholder { color: #94a3b8; }
    .dark .tool-input {
      background: #020617;
      border-color: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }
    .dark .tool-input:focus {
      border-color: rgba(45, 212, 191, 0.6);
      box-shadow: none;
    }
    .tool-input-sm { width: 5.5rem; text-align: center; }
    .tool-input::-webkit-outer-spin-button,
    .tool-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .tool-input[type='number'] { -moz-appearance: textfield; appearance: textfield; }
    .tool-input[type='date'] { font-family: inherit; font-size: 0.85rem; }
    .tool-input[type='date']::-webkit-calendar-picker-indicator { opacity: 0.55; cursor: pointer; }
    .dark .tool-input[type='date']::-webkit-calendar-picker-indicator { filter: invert(0.7); opacity: 1; }
  `,
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-sm dark:bg-slate-950/75"
      (click)="close.emit()"
      role="dialog"
      [attr.aria-label]="prefs.txt('ক্যালকুলেটর', 'Calculator')"
    >
      <div
        class="w-full max-w-[360px] max-h-[92vh] overflow-y-auto rounded-3xl bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-white/10 animate-in fade-in zoom-in-95 duration-150"
        (click)="$event.stopPropagation()"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 pt-4 pb-3">
          <div class="flex items-center gap-2.5">
            <span class="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 ring-1 ring-teal-200 inline-flex items-center justify-center dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-400/20">
              <mat-icon class="text-lg">calculate</mat-icon>
            </span>
            <div>
              <h2 class="font-bold text-sm leading-tight">{{ prefs.txt('স্মার্ট ক্যালকুলেটর', 'Smart Calculator') }}</h2>
              <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('আনলিমিটেড · নির্ভুল · লাইট/ডার্ক', 'Unlimited · exact · light/dark') }}</p>
            </div>
          </div>
          <div class="flex items-center gap-0.5">
            <button
              (click)="prefs.toggleDark()"
              class="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10"
              [title]="prefs.dark() ? prefs.txt('লাইট থিম', 'Light theme') : prefs.txt('ডার্ক থিম', 'Dark theme')"
            >
              <mat-icon class="text-lg">{{ prefs.dark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
            </button>
            <button
              (click)="close.emit()"
              class="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10"
              [title]="prefs.txt('ক্যালকুলেটর বন্ধ করুন', 'Close calculator')"
            >
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>
        </div>

        <!-- Mode tabs -->
        <div class="flex gap-1.5 overflow-x-auto px-3 pb-3 mode-scroll" role="tablist">
          @for (m of modes; track m.key) {
            <button
              role="tab"
              (click)="setMode(m.key)"
              [attr.aria-selected]="mode() === m.key"
              [class]="tabClass(m.key)"
            >
              <mat-icon class="text-sm">{{ m.icon }}</mat-icon>
              {{ prefs.txt(m.bn, m.en) }}
            </button>
          }
        </div>

        <!-- Display (shared by basic + scientific) -->
        @if (isExpressionMode()) {
          <div class="mx-3 mb-3 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-4 text-right overflow-hidden dark:bg-slate-950 dark:border-white/10">
            <div class="h-5 text-[11px] font-mono text-slate-400 truncate dark:text-slate-500">{{ formattedExpression() || prefs.txt('প্রস্তুত', 'Ready') }}</div>
            <div
              #displayBox
              class="no-bar font-mono font-semibold text-[2rem] leading-tight tracking-tight overflow-x-auto whitespace-nowrap"
              [class]="display() === 'Error' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'"
            >{{ formattedDisplay() }}</div>
            <div class="h-5 text-xs font-mono truncate" [class]="display() === 'Error' ? 'text-rose-500 dark:text-rose-400' : 'text-teal-600 dark:text-teal-400'">
              {{ display() === 'Error' ? errorNote() : preview() }}
            </div>
          </div>
        }

        @switch (mode()) {
          @case ('basic') {
            <div class="grid grid-cols-4 gap-2 px-3 pb-3">
              <button (click)="clear()" [class]="acKey('basic')" [class.calc-pressed]="pressed() === 'AC'">AC</button>
              <button (click)="backspace()" [class]="backKey('basic')" [class.calc-pressed]="pressed() === '⌫'"
                [title]="prefs.txt('এক ঘর মুছুন', 'Delete last digit')">
                <mat-icon class="text-lg">backspace</mat-icon>
              </button>
              <button (click)="toggleSign()" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '±'"
                [title]="prefs.txt('চিহ্ন পরিবর্তন', 'Change sign')">±</button>
              <button (click)="append('÷')" [class]="operatorKey('basic')" [class.calc-pressed]="pressed() === '÷'">÷</button>

              <button (click)="append('7')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '7'">7</button>
              <button (click)="append('8')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '8'">8</button>
              <button (click)="append('9')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '9'">9</button>
              <button (click)="append('×')" [class]="operatorKey('basic')" [class.calc-pressed]="pressed() === '×'">×</button>

              <button (click)="append('4')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '4'">4</button>
              <button (click)="append('5')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '5'">5</button>
              <button (click)="append('6')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '6'">6</button>
              <button (click)="append('-')" [class]="operatorKey('basic')" [class.calc-pressed]="pressed() === '-'">−</button>

              <button (click)="append('1')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '1'">1</button>
              <button (click)="append('2')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '2'">2</button>
              <button (click)="append('3')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '3'">3</button>
              <button (click)="append('+')" [class]="operatorKey('basic')" [class.calc-pressed]="pressed() === '+'">+</button>

              <button (click)="append('0')" [class]="digitKey('basic') + ' col-span-2'" [class.calc-pressed]="pressed() === '0'">0</button>
              <button (click)="append('.')" [class]="digitKey('basic')" [class.calc-pressed]="pressed() === '.'">.</button>
              <button (click)="calculate()" [class]="equalKey('basic')" [class.calc-pressed]="pressed() === '='">=</button>
            </div>
          }
          @case ('scientific') {
            <div class="flex items-center justify-between px-3 pb-2">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">{{ prefs.txt('কোণের একক', 'Angle unit') }}</span>
              <div class="flex rounded-lg overflow-hidden ring-1 ring-slate-200 dark:ring-white/10">
                <button (click)="degrees.set(true)" [class]="segClass(degrees())">Deg</button>
                <button (click)="degrees.set(false)" [class]="segClass(!degrees())">Rad</button>
              </div>
            </div>
            <div class="grid grid-cols-5 gap-1.5 px-3 pb-3">
              <button (click)="clear()" [class]="acKey('sci')" [class.calc-pressed]="pressed() === 'AC'">AC</button>
              <button (click)="backspace()" [class]="backKey('sci')" [class.calc-pressed]="pressed() === '⌫'"
                [title]="prefs.txt('এক ঘর মুছুন', 'Delete last character')">
                <mat-icon class="text-base">backspace</mat-icon>
              </button>
              <button (click)="append('(')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '('">(</button>
              <button (click)="append(')')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === ')'">)</button>
              <button (click)="toggleSign()" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '±'">±</button>

              <button (click)="append('sin(')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === 'sin('">sin</button>
              <button (click)="append('cos(')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === 'cos('">cos</button>
              <button (click)="append('tan(')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === 'tan('">tan</button>
              <button (click)="append('log(')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === 'log('">log</button>
              <button (click)="append('ln(')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === 'ln('">ln</button>

              <button (click)="append('7')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '7'">7</button>
              <button (click)="append('8')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '8'">8</button>
              <button (click)="append('9')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '9'">9</button>
              <button (click)="append('÷')" [class]="operatorKey('sci')" [class.calc-pressed]="pressed() === '÷'">÷</button>
              <button (click)="append('^')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === '^'"
                [title]="prefs.txt('পাওয়ার (x এর ঘাত)', 'Power')">^</button>

              <button (click)="append('4')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '4'">4</button>
              <button (click)="append('5')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '5'">5</button>
              <button (click)="append('6')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '6'">6</button>
              <button (click)="append('×')" [class]="operatorKey('sci')" [class.calc-pressed]="pressed() === '×'">×</button>
              <button (click)="append('√(')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === '√('">√</button>

              <button (click)="append('1')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '1'">1</button>
              <button (click)="append('2')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '2'">2</button>
              <button (click)="append('3')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '3'">3</button>
              <button (click)="append('-')" [class]="operatorKey('sci')" [class.calc-pressed]="pressed() === '-'">−</button>
              <button (click)="append('π')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === 'π'">π</button>

              <button (click)="append('0')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '0'">0</button>
              <button (click)="append('.')" [class]="digitKey('sci')" [class.calc-pressed]="pressed() === '.'">.</button>
              <button (click)="append('e')" [class]="functionKey('sci')" [class.calc-pressed]="pressed() === 'e'"
                [title]="prefs.txt('অয়লার সংখ্যা', 'Euler number')">e</button>
              <button (click)="append('+')" [class]="operatorKey('sci')" [class.calc-pressed]="pressed() === '+'">+</button>
              <button (click)="calculate()" [class]="equalKey('sci')" [class.calc-pressed]="pressed() === '='">=</button>
            </div>
          }
          @case ('weight') {
            <div class="px-3 pb-3 space-y-3">
              <div class="grid grid-cols-5 gap-1.5">
                @for (u of weightUnits; track u.key) {
                  <button (click)="weightUnit.set(u.key)" [class]="chipClass(u.key === weightUnit())">{{ prefs.txt(u.bn, u.en) }}</button>
                }
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1 dark:text-slate-400">{{ prefs.txt('পরিমাণ', 'Amount') }}</label>
                <input type="number" inputmode="decimal" step="any" min="0" class="tool-input"
                  [value]="weightAmount()" (input)="weightAmount.set($any($event.target).value)" />
              </div>
              <div class="rounded-2xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 dark:bg-slate-950 dark:border-white/10 dark:divide-white/5">
                @for (r of weightResults(); track r.key) {
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <span [class]="rowLabelClass(r.key === weightUnit())">{{ prefs.txt(r.bn, r.en) }}</span>
                    <span class="text-sm font-mono font-semibold text-slate-900 dark:text-white">{{ r.value }}</span>
                  </div>
                }
              </div>
              <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2.5 dark:bg-slate-950 dark:border-white/10">
                <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ prefs.txt('দাম হিসাব', 'Price calculator') }}</div>
                <div class="flex gap-1.5">
                  @for (b of weightPriceBasis; track b.key) {
                    <button (click)="weightRateBasis.set(b.key)" [class]="basisClass(weightRateBasis() === b.key)">{{ prefs.txt(b.bn, b.en) }}</button>
                  }
                </div>
                <input type="number" inputmode="decimal" step="any" min="0" class="tool-input"
                  [placeholder]="prefs.txt('দর লিখুন (টাকা)', 'Enter rate (BDT)')"
                  [value]="weightRate()" (input)="weightRate.set($any($event.target).value)" />
                @if (weightPrice().hasRate) {
                  <div class="flex items-center justify-between px-1 pt-1">
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট মূল্য', 'Total price') }}</span>
                    <span class="text-lg font-bold text-teal-600 dark:text-teal-300">৳ {{ weightPrice().total }}</span>
                  </div>
                  <div class="text-[10px] text-slate-500 px-1 truncate">
                    {{ prefs.txt('সমতুল্য দর:', 'Equivalent rate:') }} ৳{{ weightPrice().perKg }}/{{ prefs.txt('কেজি', 'kg') }} · ৳{{ weightPrice().perMaund }}/{{ prefs.txt('মণ', 'maund') }}
                  </div>
                }
              </div>
            </div>
          }
          @case ('count') {
            <div class="px-3 pb-3 space-y-3">
              <div class="grid grid-cols-5 gap-1.5">
                @for (u of countUnits; track u.key) {
                  <button (click)="countUnit.set(u.key)" [class]="chipClass(u.key === countUnit())">{{ prefs.txt(u.bn, u.en) }}</button>
                }
              </div>
              <div>
                <label class="block text-[11px] text-slate-500 mb-1 dark:text-slate-400">{{ prefs.txt('সংখ্যা', 'Quantity') }}</label>
                <input type="number" inputmode="decimal" step="any" min="0" class="tool-input"
                  [value]="countAmount()" (input)="countAmount.set($any($event.target).value)" />
              </div>
              <div class="rounded-2xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 dark:bg-slate-950 dark:border-white/10 dark:divide-white/5">
                @for (r of countResults(); track r.key) {
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <span [class]="rowLabelClass(r.key === countUnit())">{{ prefs.txt(r.bn, r.en) }}</span>
                    <span class="text-sm font-mono font-semibold text-slate-900 dark:text-white">{{ r.value }}</span>
                  </div>
                }
              </div>
              <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2.5 dark:bg-slate-950 dark:border-white/10">
                <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ prefs.txt('দাম হিসাব', 'Price calculator') }}</div>
                <div class="flex gap-1.5">
                  @for (b of countPriceBasis; track b.key) {
                    <button (click)="countRateBasis.set(b.key)" [class]="basisClass(countRateBasis() === b.key)">{{ prefs.txt(b.bn, b.en) }}</button>
                  }
                </div>
                <input type="number" inputmode="decimal" step="any" min="0" class="tool-input"
                  [placeholder]="prefs.txt('দর লিখুন (টাকা)', 'Enter rate (BDT)')"
                  [value]="countRate()" (input)="countRate.set($any($event.target).value)" />
                @if (countPrice().hasRate) {
                  <div class="flex items-center justify-between px-1 pt-1">
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট মূল্য', 'Total price') }}</span>
                    <span class="text-lg font-bold text-teal-600 dark:text-teal-300">৳ {{ countPrice().total }}</span>
                  </div>
                  <div class="text-[10px] text-slate-500 px-1 truncate">
                    {{ prefs.txt('সমতুল্য দর:', 'Equivalent rate:') }} ৳{{ countPrice().perPcs }}/{{ prefs.txt('পিস', 'pc') }} · ৳{{ countPrice().perDozen }}/{{ prefs.txt('ডজন', 'dozen') }}
                  </div>
                }
              </div>
            </div>
          }
          @case ('percent') {
            <div class="px-3 pb-3 space-y-3">
              <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2 dark:bg-slate-950 dark:border-white/10">
                <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ prefs.txt('১. সংখ্যার শতকরা অংশ', '1. Percent of a number') }}</div>
                <div class="flex items-center gap-2">
                  <input type="number" inputmode="decimal" step="any" class="tool-input tool-input-sm"
                    [value]="p1x()" (input)="p1x.set($any($event.target).value)" />
                  <span class="text-slate-500 text-sm font-bold shrink-0 dark:text-slate-400">%</span>
                  <span class="text-slate-400 text-sm shrink-0 dark:text-slate-500">×</span>
                  <input type="number" inputmode="decimal" step="any" class="tool-input flex-1"
                    [value]="p1y()" (input)="p1y.set($any($event.target).value)" />
                </div>
                <div class="text-right text-base font-mono font-bold text-teal-600 dark:text-teal-300">= {{ percentOf() }}</div>
              </div>
              <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2 dark:bg-slate-950 dark:border-white/10">
                <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ prefs.txt('২. কত শতাংশ?', '2. What percentage?') }}</div>
                <div class="flex items-center gap-2">
                  <input type="number" inputmode="decimal" step="any" class="tool-input flex-1"
                    [value]="p2a()" (input)="p2a.set($any($event.target).value)" />
                  <span class="text-slate-500 text-xs shrink-0 dark:text-slate-400">{{ prefs.txt('মধ্যে', 'out of') }}</span>
                  <input type="number" inputmode="decimal" step="any" class="tool-input flex-1"
                    [value]="p2b()" (input)="p2b.set($any($event.target).value)" />
                </div>
                <div class="text-right text-base font-mono font-bold text-teal-600 dark:text-teal-300">= {{ percentIsWhat() }}</div>
              </div>
              <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2 dark:bg-slate-950 dark:border-white/10">
                <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ prefs.txt('৩. বৃদ্ধি / হ্রাস', '3. Increase / decrease') }}</div>
                <div class="flex items-center gap-2">
                  <input type="number" inputmode="decimal" step="any" class="tool-input flex-1"
                    [value]="p3from()" (input)="p3from.set($any($event.target).value)" />
                  <mat-icon class="text-sm text-slate-400 shrink-0 dark:text-slate-500">east</mat-icon>
                  <input type="number" inputmode="decimal" step="any" class="tool-input flex-1"
                    [value]="p3to()" (input)="p3to.set($any($event.target).value)" />
                </div>
                <div class="text-right text-base font-mono font-bold" [class]="percentChange().up ? 'text-teal-600 dark:text-teal-300' : 'text-rose-600 dark:text-rose-300'">
                  = {{ percentChange().text }}
                </div>
              </div>
            </div>
          }
          @case ('age') {
            <div class="px-3 pb-3 space-y-3">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-[11px] text-slate-500 mb-1 dark:text-slate-400">{{ prefs.txt('জন্ম তারিখ', 'Date of birth') }}</label>
                  <input type="date" class="tool-input" [value]="birthDate()" (input)="birthDate.set($any($event.target).value)" />
                </div>
                <div>
                  <label class="block text-[11px] text-slate-500 mb-1 dark:text-slate-400">{{ prefs.txt('হিসাবের তারিখ', 'As of date') }}</label>
                  <input type="date" class="tool-input" [value]="asOfDate()" (input)="asOfDate.set($any($event.target).value)" />
                </div>
              </div>
              @if (ageResult(); as age) {
                <div class="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-4 text-center dark:bg-slate-950 dark:border-white/10">
                  <div class="text-2xl font-black text-slate-900 leading-tight dark:text-white">
                    {{ age.years }} <span class="text-sm font-bold text-teal-600 dark:text-teal-300">{{ prefs.txt('বছর', 'y') }}</span>
                    {{ age.months }} <span class="text-sm font-bold text-teal-600 dark:text-teal-300">{{ prefs.txt('মাস', 'm') }}</span>
                    {{ age.days }} <span class="text-sm font-bold text-teal-600 dark:text-teal-300">{{ prefs.txt('দিন', 'd') }}</span>
                  </div>
                  <div class="text-[10px] text-slate-500 mt-1">{{ prefs.txt('সঠিক বয়স', 'Exact age') }}</div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div class="rounded-xl bg-white border border-slate-200 px-3 py-2.5 dark:bg-white/[0.04] dark:border-white/5">
                    <div class="text-sm font-mono font-bold text-slate-900 dark:text-white">{{ age.totalMonths }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট মাস', 'Total months') }}</div>
                  </div>
                  <div class="rounded-xl bg-white border border-slate-200 px-3 py-2.5 dark:bg-white/[0.04] dark:border-white/5">
                    <div class="text-sm font-mono font-bold text-slate-900 dark:text-white">{{ age.totalWeeks }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট সপ্তাহ', 'Total weeks') }}</div>
                  </div>
                  <div class="rounded-xl bg-white border border-slate-200 px-3 py-2.5 dark:bg-white/[0.04] dark:border-white/5">
                    <div class="text-sm font-mono font-bold text-slate-900 dark:text-white">{{ age.totalDays }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট দিন', 'Total days') }}</div>
                  </div>
                  <div class="rounded-xl bg-white border border-slate-200 px-3 py-2.5 dark:bg-white/[0.04] dark:border-white/5">
                    <div class="text-sm font-mono font-bold text-slate-900 dark:text-white">{{ age.totalHours }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ prefs.txt('মোট ঘণ্টা', 'Total hours') }}</div>
                  </div>
                </div>
                <div class="rounded-2xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 dark:bg-slate-950 dark:border-white/10 dark:divide-white/5">
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ prefs.txt('জন্মের বার', 'Born on') }}</span>
                    <span class="text-sm font-semibold text-slate-900 dark:text-white">{{ age.birthWeekday }}</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ prefs.txt('আসন্ন জন্মদিন', 'Next birthday') }}</span>
                    @if (age.daysToBirthday === 0) {
                      <span class="text-sm font-bold text-teal-600 dark:text-teal-300">{{ prefs.txt('আজ 🎉', 'Today 🎉') }}</span>
                    } @else {
                      <span class="text-sm font-mono font-semibold text-slate-900 dark:text-white">{{ age.daysToBirthday }} {{ prefs.txt('দিন বাকি', 'days left') }} · {{ age.nextBirthdayWeekday }}</span>
                    }
                  </div>
                </div>
              } @else {
                <div class="rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300">
                  {{ prefs.txt('জন্ম তারিখ ও হিসাবের তারিখ দিন — জন্ম তারিখ হিসাবের তারিখের পরে হতে পারে না।', 'Enter both dates — birth date cannot be after the as-of date.') }}
                </div>
              }
            </div>
          }
          @case ('vat') {
            <div class="px-3 pb-3 space-y-3">
              <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2.5 dark:bg-slate-950 dark:border-white/10">
                <div>
                  <label class="block text-[11px] text-slate-500 mb-1 dark:text-slate-400">{{ prefs.txt('মূল মূল্য (টাকা)', 'Base price (BDT)') }}</label>
                  <input type="number" inputmode="decimal" step="any" min="0" class="tool-input"
                    [value]="vatPrice()" (input)="vatPrice.set($any($event.target).value)" />
                </div>
                <div>
                  <label class="block text-[11px] text-slate-500 mb-1 dark:text-slate-400">{{ prefs.txt('ছাড় (%)', 'Discount (%)') }}</label>
                  <input type="number" inputmode="decimal" step="any" min="0" class="tool-input"
                    [value]="vatDiscount()" (input)="vatDiscount.set($any($event.target).value)" />
                  <div class="flex gap-1.5 mt-1.5">
                    @for (c of discountChips; track c) {
                      <button (click)="vatDiscount.set(c)" [class]="miniChipClass(vatDiscount() === c)">{{ c }}%</button>
                    }
                  </div>
                </div>
                <div>
                  <label class="block text-[11px] text-slate-500 mb-1 dark:text-slate-400">{{ prefs.txt('ভ্যাট (%)', 'VAT (%)') }}</label>
                  <input type="number" inputmode="decimal" step="any" min="0" class="tool-input"
                    [value]="vatRate()" (input)="vatRate.set($any($event.target).value)" />
                  <div class="flex gap-1.5 mt-1.5">
                    @for (c of vatChips; track c) {
                      <button (click)="vatRate.set(c)" [class]="miniChipClass(vatRate() === c)">{{ c }}%</button>
                    }
                  </div>
                </div>
              </div>
              @if (vatResult().hasInput) {
                <div class="rounded-2xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 dark:bg-slate-950 dark:border-white/10 dark:divide-white/5">
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ prefs.txt('মূল মূল্য', 'Base price') }}</span>
                    <span class="text-sm font-mono font-semibold text-slate-900 dark:text-white">৳ {{ vatResult().base }}</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ prefs.txt('ছাড়', 'Discount') }} ({{ vatResult().discPct }}%)</span>
                    <span class="text-sm font-mono font-semibold text-rose-600 dark:text-rose-300">− ৳ {{ vatResult().discount }}</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-2.5">
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ prefs.txt('ভ্যাট', 'VAT') }} ({{ vatResult().vatPct }}%)</span>
                    <span class="text-sm font-mono font-semibold text-amber-600 dark:text-amber-300">+ ৳ {{ vatResult().vat }}</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-3">
                    <span class="text-xs font-bold text-teal-600 dark:text-teal-300">{{ prefs.txt('সর্বমোট', 'Grand total') }}</span>
                    <span class="text-lg font-black text-teal-600 dark:text-teal-300">৳ {{ vatResult().total }}</span>
                  </div>
                </div>
              }
            </div>
          }
        }

        <!-- Contextual hint -->
        <div class="rounded-b-3xl px-5 py-2.5 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500 flex items-center gap-1.5 sticky bottom-0 backdrop-blur-sm dark:bg-white/5 dark:border-white/5 dark:text-slate-500">
          <mat-icon class="text-xs">{{ isExpressionMode() ? 'keyboard' : 'touch_app' }}</mat-icon>
          <span class="truncate">{{ hint() }}</span>
        </div>
      </div>
    </div>
  `
})
export class CalculatorModal {
  readonly prefs = inject(PreferencesService);
  readonly close = output<void>();

  readonly mode = signal<Mode>('basic');

  // ── Shared expression state (basic + scientific) ──
  readonly display = signal<string>('0');
  readonly expression = signal<string>('');
  readonly preview = signal<string>('');
  readonly errorNote = signal('');
  readonly pressed = signal<string | null>(null);
  readonly degrees = signal<boolean>(true);

  readonly isExpressionMode = computed(() => {
    const mode = this.mode();
    return mode === 'basic' || mode === 'scientific';
  });
  readonly formattedDisplay = computed(() => this.spaced(this.display()));
  readonly formattedExpression = computed(() => this.spaced(this.expression()));

  private readonly displayBox = viewChild<ElementRef<HTMLDivElement>>('displayBox');
  private justEvaluated = false;
  private pressedTimer?: ReturnType<typeof setTimeout>;

  // ── Weight (বাজার সেট: 1 মণ = 40 সের, 1 সের ≈ 933.105 গ্রাম) ──
  readonly weightUnits: readonly UnitDef[] = [
    { key: 'maund', bn: 'মণ', en: 'Maund', factor: 37.3242, digits: 4 },
    { key: 'seer', bn: 'সের', en: 'Seer', factor: 0.933105, digits: 4 },
    { key: 'kg', bn: 'কেজি', en: 'Kg', factor: 1, digits: 3 },
    { key: 'g', bn: 'গ্রাম', en: 'Gram', factor: 0.001, digits: 1 },
    { key: 'lb', bn: 'পাউন্ড', en: 'Pound', factor: 0.45359237, digits: 3 },
  ];
  readonly weightPriceBasis: readonly BasisDef[] = [
    { key: 'kg', bn: 'প্রতি কেজি', en: 'Per kg' },
    { key: 'maund', bn: 'প্রতি মণ', en: 'Per maund' },
    { key: 'seer', bn: 'প্রতি সের', en: 'Per seer' },
  ];
  readonly weightAmount = signal('1');
  readonly weightUnit = signal('kg');
  readonly weightRate = signal('');
  readonly weightRateBasis = signal('kg');

  // ── Count (পিস → গণ্ডা ৫ → হালি ৪ → ডজন ১২ → কুড়ি ২০) ──
  readonly countUnits: readonly UnitDef[] = [
    { key: 'pcs', bn: 'পিস', en: 'Pc', factor: 1, digits: 2 },
    { key: 'gonda', bn: 'গণ্ডা', en: 'Gonda', factor: 5, digits: 3 },
    { key: 'hali', bn: 'হালি', en: 'Hali', factor: 4, digits: 3 },
    { key: 'dozen', bn: 'ডজন', en: 'Dozen', factor: 12, digits: 4 },
    { key: 'kuri', bn: 'কুড়ি', en: 'Kuri', factor: 20, digits: 4 },
  ];
  readonly countPriceBasis: readonly BasisDef[] = [
    { key: 'pcs', bn: 'প্রতি পিস', en: 'Per pc' },
    { key: 'hali', bn: 'প্রতি হালি', en: 'Per hali' },
    { key: 'dozen', bn: 'প্রতি ডজন', en: 'Per dozen' },
    { key: 'kuri', bn: 'প্রতি কুড়ি', en: 'Per kuri' },
  ];
  readonly countAmount = signal('12');
  readonly countUnit = signal('pcs');
  readonly countRate = signal('');
  readonly countRateBasis = signal('pcs');

  // ── Percent ──
  readonly p1x = signal('15');
  readonly p1y = signal('200');
  readonly p2a = signal('45');
  readonly p2b = signal('60');
  readonly p3from = signal('80');
  readonly p3to = signal('100');

  // ── Age ──
  readonly birthDate = signal('2000-01-15');
  readonly asOfDate = signal(this.today());

  // ── Discount / VAT ──
  readonly vatPrice = signal('1000');
  readonly vatDiscount = signal('10');
  readonly vatRate = signal('15');
  readonly discountChips = ['0', '5', '10', '20', '25'];
  readonly vatChips = ['0', '5', '7.5', '15'];

  readonly modes = [
    { key: 'basic' as Mode, bn: 'সাধারণ', en: 'Basic', icon: 'calculate' },
    { key: 'scientific' as Mode, bn: 'বৈজ্ঞানিক', en: 'Scientific', icon: 'functions' },
    { key: 'weight' as Mode, bn: 'ওজন', en: 'Weight', icon: 'scale' },
    { key: 'count' as Mode, bn: 'হালি-ডজন', en: 'Count', icon: 'shopping_basket' },
    { key: 'percent' as Mode, bn: 'শতকরা', en: 'Percent', icon: 'percent' },
    { key: 'age' as Mode, bn: 'বয়স', en: 'Age', icon: 'cake' },
    { key: 'vat' as Mode, bn: 'ছাড়-ভ্যাট', en: 'Discount·VAT', icon: 'receipt_long' },
  ];

  constructor() {
    // Keep the newest digits visible: long sums scroll inside the display.
    effect(() => {
      this.display();
      const box = this.displayBox()?.nativeElement;
      if (box) queueMicrotask(() => { box.scrollLeft = box.scrollWidth; });
    });
  }

  // ── Computed results ──
  readonly weightResults = computed(() => {
    const kg = this.toBase(this.weightAmount(), this.weightUnit(), this.weightUnits);
    return this.weightUnits.map(u => ({ key: u.key, bn: u.bn, en: u.en, value: this.fmt(kg / u.factor, u.digits) }));
  });

  readonly weightPrice = computed(() => {
    const rate = this.parseNum(this.weightRate());
    const kg = this.toBase(this.weightAmount(), this.weightUnit(), this.weightUnits);
    const factor = this.weightUnits.find(u => u.key === this.weightRateBasis())?.factor ?? 1;
    const perKg = rate / factor;
    return {
      hasRate: rate > 0,
      total: this.money(kg * perKg),
      perKg: this.money(perKg),
      perMaund: this.money(perKg * 37.3242),
    };
  });

  readonly countResults = computed(() => {
    const pcs = this.toBase(this.countAmount(), this.countUnit(), this.countUnits);
    return this.countUnits.map(u => ({ key: u.key, bn: u.bn, en: u.en, value: this.fmt(pcs / u.factor, u.digits) }));
  });

  readonly countPrice = computed(() => {
    const rate = this.parseNum(this.countRate());
    const pcs = this.toBase(this.countAmount(), this.countUnit(), this.countUnits);
    const factor = this.countUnits.find(u => u.key === this.countRateBasis())?.factor ?? 1;
    const perPcs = rate / factor;
    return {
      hasRate: rate > 0,
      total: this.money(pcs * perPcs),
      perPcs: this.money(perPcs),
      perDozen: this.money(perPcs * 12),
    };
  });

  readonly percentOf = computed(() => this.fmt(this.parseNum(this.p1x()) / 100 * this.parseNum(this.p1y()), 2));

  readonly percentIsWhat = computed(() => {
    const b = this.parseNum(this.p2b());
    return b === 0 ? '—' : this.fmt(this.parseNum(this.p2a()) / b * 100, 2) + '%';
  });

  readonly percentChange = computed(() => {
    const a = this.parseNum(this.p3from());
    const b = this.parseNum(this.p3to());
    if (a === 0) return { text: '—', up: true };
    const pct = (b - a) / a * 100;
    return { text: (pct >= 0 ? '+' : '−') + this.fmt(Math.abs(pct), 2) + '%', up: pct >= 0 };
  });

  readonly ageResult = computed(() => {
    const from = this.parseDate(this.birthDate());
    const to = this.parseDate(this.asOfDate());
    if (!from || !to || to.getTime() < from.getTime()) return null;

    let years = to.getFullYear() - from.getFullYear();
    let months = to.getMonth() - from.getMonth();
    let days = to.getDate() - from.getDate();
    if (days < 0) {
      months -= 1;
      days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    const totalDays = Math.floor((to.getTime() - from.getTime()) / 86400000);
    let nextBirthday = new Date(to.getFullYear(), from.getMonth(), from.getDate());
    if (nextBirthday.getTime() < to.getTime()) {
      nextBirthday = new Date(to.getFullYear() + 1, from.getMonth(), from.getDate());
    }
    const daysToBirthday = Math.round((nextBirthday.getTime() - to.getTime()) / 86400000);
    return {
      years, months, days,
      totalMonths: this.fmt(years * 12 + months, 0),
      totalWeeks: this.fmt(Math.floor(totalDays / 7), 0),
      totalDays: this.fmt(totalDays, 0),
      totalHours: this.fmt(totalDays * 24, 0),
      birthWeekday: this.weekday(from),
      daysToBirthday,
      nextBirthdayWeekday: this.weekday(nextBirthday),
    };
  });

  readonly vatResult = computed(() => {
    const price = this.parseNum(this.vatPrice());
    const discPct = this.parseNum(this.vatDiscount());
    const vatPct = this.parseNum(this.vatRate());
    const discount = price * discPct / 100;
    const afterDiscount = price - discount;
    const vat = afterDiscount * vatPct / 100;
    return {
      hasInput: price > 0,
      base: this.money(price),
      discPct: this.fmt(discPct, 2),
      vatPct: this.fmt(vatPct, 2),
      discount: this.money(discount),
      vat: this.money(vat),
      total: this.money(afterDiscount + vat),
    };
  });

  readonly hint = computed(() => {
    switch (this.mode()) {
      case 'scientific': return this.prefs.txt('sin cos tan · log ln √ π · ( ) ^ · Enter = · Esc AC', 'sin cos tan · log ln √ π · ( ) ^ · Enter = · Esc AC');
      case 'weight': return this.prefs.txt('পরিমাণ ও দর লিখলেই সব এককে হিসাব হয়ে যাবে', 'Type amount & rate — converts to all units');
      case 'count': return this.prefs.txt('পিস থেকে গণ্ডা, হালি, ডজন, কুড়ি — এক সাথে সব', 'Pieces, gonda, hali, dozen & kuri at once');
      case 'percent': return this.prefs.txt('তিন রকম শতকরা হিসাব — লাইভ ফলাফল', 'Three percentage calcs with live results');
      case 'age': return this.prefs.txt('জন্ম তারিখ দিলেই বয়স ও জন্মদিনের হিসাব', 'Enter birth date for age & birthday info');
      case 'vat': return this.prefs.txt('ছাড় ও ভ্যাটসহ চূড়ান্ত মূল্য', 'Final price with discount & VAT');
      default: return this.prefs.txt('যত খুশি সংখ্যা যোগ করুন · Enter = · Esc AC', 'Add unlimited numbers · Enter = · Esc AC');
    }
  });

  // ── Key styling (light + dark) ──
  digitKey(size: 'basic' | 'sci'): string {
    return `calc-key ${this.keyShape(size)} font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200/80 dark:bg-white/[0.07] dark:hover:bg-white/15 dark:text-white dark:border-transparent cursor-pointer`;
  }

  operatorKey(size: 'basic' | 'sci'): string {
    return `calc-key ${this.keyShape(size)} font-bold bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200/70 dark:bg-teal-500/15 dark:hover:bg-teal-500/25 dark:text-teal-300 dark:border-transparent cursor-pointer`;
  }

  functionKey(size: 'basic' | 'sci'): string {
    return `calc-key ${this.keyShape(size)} font-bold bg-teal-50/60 hover:bg-teal-100 text-teal-700 border border-teal-200/50 dark:bg-teal-500/10 dark:hover:bg-teal-500/20 dark:text-teal-300 dark:border-transparent cursor-pointer`;
  }

  acKey(size: 'basic' | 'sci'): string {
    return `calc-key ${this.keyShape(size)} font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/70 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:text-rose-300 dark:border-transparent cursor-pointer`;
  }

  backKey(size: 'basic' | 'sci'): string {
    return `calc-key ${this.keyShape(size)} inline-flex items-center justify-center bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200/70 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 dark:text-amber-300 dark:border-transparent cursor-pointer`;
  }

  equalKey(size: 'basic' | 'sci'): string {
    return `calc-key ${this.keyShape(size)} font-black bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/25 dark:bg-teal-500 dark:hover:bg-teal-400 dark:text-slate-950 dark:shadow-teal-500/20 cursor-pointer`;
  }

  tabClass(key: Mode): string {
    const base = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer shrink-0';
    return this.mode() === key
      ? `${base} bg-teal-600 text-white shadow-sm shadow-teal-600/25 dark:bg-teal-500 dark:text-slate-950`
      : `${base} bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.07] dark:text-slate-300 dark:hover:bg-white/15`;
  }

  segClass(active: boolean): string {
    const base = 'px-3 py-1 text-[11px] font-bold transition-colors cursor-pointer';
    return active
      ? `${base} bg-teal-600 text-white dark:bg-teal-500 dark:text-slate-950`
      : `${base} bg-white text-slate-500 hover:bg-slate-100 dark:bg-white/[0.07] dark:text-slate-400 dark:hover:bg-white/15`;
  }

  chipClass(active: boolean): string {
    const base = 'h-9 rounded-xl text-xs font-bold transition-colors cursor-pointer';
    return active
      ? `${base} bg-teal-600 text-white shadow-sm shadow-teal-600/20 dark:bg-teal-500/25 dark:text-teal-200 dark:ring-1 dark:ring-teal-400/40`
      : `${base} bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-white/10`;
  }

  basisClass(active: boolean): string {
    const base = 'flex-1 h-8 rounded-lg text-[11px] font-bold transition-colors cursor-pointer';
    return active
      ? `${base} bg-teal-600 text-white dark:bg-teal-500/25 dark:text-teal-200 dark:ring-1 dark:ring-teal-400/40`
      : `${base} bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-white/10`;
  }

  miniChipClass(active: boolean): string {
    const base = 'flex-1 h-7 rounded-lg text-[11px] font-bold transition-colors cursor-pointer';
    return active
      ? `${base} bg-teal-600 text-white dark:bg-teal-500/25 dark:text-teal-200 dark:ring-1 dark:ring-teal-400/40`
      : `${base} bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-400 dark:hover:bg-white/10`;
  }

  rowLabelClass(active: boolean): string {
    return active
      ? 'text-xs font-semibold text-teal-600 dark:text-teal-300'
      : 'text-xs font-semibold text-slate-500 dark:text-slate-400';
  }

  private keyShape(size: 'basic' | 'sci'): string {
    return size === 'basic' ? 'h-14 rounded-2xl text-xl' : 'h-12 rounded-xl text-lg';
  }

  // ── Modes ──
  setMode(mode: Mode) {
    const prev = this.mode();
    if (prev === mode) return;
    this.mode.set(mode);
    const wasExpression = prev === 'basic' || prev === 'scientific';
    const isExpression = mode === 'basic' || mode === 'scientific';
    if (wasExpression !== isExpression || (wasExpression && !/^[\d.+\-×÷^()a-zπ√]*$/i.test(this.display()))) {
      this.resetAll();
      this.justEvaluated = false;
    }
  }

  // ── Keyboard ──
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (!this.isExpressionMode()) return;

    const key = event.key;
    const sci = this.mode() === 'scientific';
    let action: (() => void) | null = null;
    let visual = '';

    if (/^\d$/.test(key)) {
      action = () => this.append(key);
      visual = key;
    } else if (key === '.' || key === ',') {
      action = () => this.append('.');
      visual = '.';
    } else if (key === '+' || key === '-' || key === '*' || key === '/') {
      const value: string = key === '*' ? '×' : key === '/' ? '÷' : key;
      action = () => this.append(value);
      visual = value;
    } else if (key === 'x' || key === 'X') {
      action = () => this.append('×');
      visual = '×';
    } else if (sci && (key === '(' || key === ')' || key === '^')) {
      action = () => this.append(key);
      visual = key;
    } else if (key === 'Enter' || key === '=') {
      action = () => this.calculate();
      visual = '=';
    } else if (key === 'Backspace') {
      action = () => this.backspace();
      visual = '⌫';
    } else if (key === 'Escape' || key === 'Delete') {
      action = () => this.clear();
      visual = 'AC';
    } else {
      return;
    }

    event.preventDefault();
    action();
    this.pulse(visual);
  }

  // ── Entry (basic + scientific) ──
  append(value: string) {
    if (this.mode() === 'scientific') {
      this.appendSci(value);
    } else {
      this.appendBasic(value);
    }
    this.refreshPreview();
  }

  private appendBasic(value: string) {
    let current = this.display();

    if (current === 'Error') {
      this.resetAll();
      current = '0';
    }

    const isDigit = /^\d$/.test(value);
    const isOperator = value === '+' || value === '-' || value === '×' || value === '÷';

    if (this.justEvaluated) {
      this.justEvaluated = false;
      this.expression.set('');
      this.preview.set('');
      if (!isOperator) current = value === '.' ? '0' : '';
    }

    if (isOperator) {
      if (current === '' || current === '0') {
        if (value === '-') this.display.set('-');
        return;
      }
      const last = current.slice(-1);
      this.display.set(
        last === '+' || last === '-' || last === '×' || last === '÷'
          ? current.slice(0, -1) + value
          : current + value
      );
      return;
    }

    const lastSegment = current.split(/[+\-×÷]/).pop() ?? '';

    if (value === '.') {
      if (lastSegment.includes('.')) return;
      this.display.set(lastSegment ? current + '.' : current + '0.');
      return;
    }

    if (!isDigit) return;

    if (lastSegment === '0' && current.length > 0) {
      this.display.set(current.slice(0, -1) + value);
      return;
    }

    this.display.set(current + value);
  }

  private appendSci(value: string) {
    let current = this.display();
    if (current === 'Error') {
      this.resetAll();
      current = '';
    }
    if (this.justEvaluated) {
      this.justEvaluated = false;
      this.expression.set('');
      this.preview.set('');
      // Keep a finished result when chaining "19 × 3"; start clean otherwise.
      const chains = value === '+' || value === '-' || value === '×' || value === '÷' || value === '^';
      if (!chains) current = '';
    }
    if (value === '.') {
      const lastNumber = /[\d.]*$/.exec(current)?.[0] ?? '';
      if (lastNumber.includes('.')) return;
      this.display.set(current + (lastNumber ? '.' : '0.'));
      return;
    }
    // A bare 0 is a placeholder here: "sin(" or "π" must start the expression,
    // not turn it into "0sin(" which evaluates to a garbage Error.
    const opensGroup = value === '(' || value.endsWith('(') || value === 'π' || value === 'e';
    if (current === '0' && opensGroup) current = '';
    this.display.set(current === '0' && /^\d$/.test(value) ? value : current + value);
  }

  toggleSign() {
    const current = this.display();
    if (current === '0' || current === 'Error' || current === '') return;

    const match = /(-?\d*\.?\d+)$/.exec(current);
    if (!match) return;

    const number = match[1];
    const head = current.slice(0, current.length - number.length);
    this.display.set(number.startsWith('-') ? head + number.slice(1) : head + '-' + number);
    this.refreshPreview();
  }

  clear() {
    this.resetAll();
    this.justEvaluated = false;
  }

  backspace() {
    const current = this.display();
    if (current === 'Error') {
      this.resetAll();
      return;
    }
    if (this.justEvaluated) {
      this.justEvaluated = false;
      this.expression.set('');
    }
    this.display.set(current.length > 1 ? current.slice(0, -1) : '0');
    this.refreshPreview();
  }

  calculate() {
    const raw = this.display();
    if (raw === 'Error' || !raw || /[+\-×÷^]$/.test(raw)) {
      this.flashError('syntax');
      return;
    }

    try {
      const result = evaluateExpression(raw, { degrees: this.degrees() });
      this.expression.set(raw + ' =');
      this.display.set(formatDec(result));
      this.preview.set('');
      this.errorNote.set('');
      this.justEvaluated = true;
    } catch (error) {
      this.flashError(error instanceof CalcError ? error.code : 'syntax');
    }
  }

  // ── Internal state helpers ──
  private resetAll() {
    this.display.set('0');
    this.expression.set('');
    this.preview.set('');
    this.errorNote.set('');
  }

  private flashError(code: CalcError['code']) {
    this.display.set('Error');
    this.expression.set('');
    this.preview.set('');
    this.justEvaluated = false;
    this.errorNote.set(code === 'div0'
      ? this.prefs.txt('শূন্য দিয়ে ভাগ করা যায় না', 'Cannot divide by zero')
      : this.prefs.txt('সমীকরণটি সম্পূর্ণ করুন', 'Complete the expression'));
  }

  private refreshPreview() {
    const raw = this.display();
    this.preview.set('');
    if (!raw || raw === 'Error' || /[+\-×÷^*/]$/.test(raw)) return;
    if (!/[+\-×÷^*/]/.test(raw) && !/[a-zπ√]/i.test(raw)) return;

    try {
      const result = evaluateExpression(raw, { degrees: this.degrees() });
      this.preview.set('= ' + formatDec(result));
    } catch { /* Incomplete expression: keep the preview blank. */ }
  }

  private spaced(value: string): string {
    return value
      .replace(/×/g, ' × ')
      .replace(/÷/g, ' ÷ ')
      .replace(/\+/g, ' + ')
      .replace(/(\d)-/g, '$1 − ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private pulse(key: string) {
    if (!key) return;
    this.pressed.set(key);
    clearTimeout(this.pressedTimer);
    this.pressedTimer = setTimeout(() => this.pressed.set(null), 140);
  }

  // ── Tool helpers ──
  private parseNum(value: string): number {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  private toBase(amount: string, unitKey: string, units: readonly UnitDef[]): number {
    const factor = units.find(u => u.key === unitKey)?.factor ?? 1;
    return this.parseNum(amount) * factor;
  }

  private fmt(value: number, digits = 2): string {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(Number(value.toPrecision(12)));
  }

  private money(value: number): string {
    return this.fmt(value, 2);
  }

  private today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private parseDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private weekday(date: Date): string {
    return this.prefs.txt(this.weekdaysBn[date.getDay()], this.weekdaysEn[date.getDay()]);
  }

  private readonly weekdaysBn = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
  private readonly weekdaysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
}
