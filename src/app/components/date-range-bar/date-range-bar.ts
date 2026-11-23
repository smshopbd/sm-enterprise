import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PreferencesService } from '../../services/preferences';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import {
  DATE_RANGE_PRESETS,
  DateRange,
  DateRangeKind,
  activeDateRangeKind,
  rangeDayCount,
  resolveDateRange
} from '../../utils/date-range';
import { dmyFromIso } from '../../utils/local-date';

/** Shared date filter: preset periods plus a custom from/to window. */
@Component({
  selector: 'app-date-range-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, DmyDateDirective],
  template: `
    <div
      class="no-print flex flex-wrap items-center gap-1.5"
      [class]="toggleable()
        ? (enabled() ? 'border-t border-slate-200 pt-2' : '')
        : 'rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-2xs'"
    >
      @if (toggleable()) {
        <label
          class="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-extrabold transition-colors"
          [class]="enabled()
            ? 'border-teal-200 bg-teal-50 text-teal-800'
            : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'"
          [title]="txt('তারিখ অনুযায়ী ফিল্টার চালু/বন্ধ করুন', 'Turn the date filter on or off')"
        >
          <input
            type="checkbox"
            class="size-3.5 cursor-pointer accent-teal-600"
            [checked]="enabled()"
            (change)="toggleEnabled($event)"
          />
          <mat-icon class="text-sm">{{ enabled() ? 'calendar_month' : 'date_range' }}</mat-icon>
          @if (enabled()) {
            {{ label() }}
            @if (dayCount() > 0) {
              <span class="rounded bg-white/80 px-1 font-mono text-[9.5px]">{{ dayCount() }} {{ txt('দিন', 'd') }}</span>
            }
          } @else {
            {{ txt('সব সময়', 'All time') }}
          }
        </label>
      } @else {
        <span class="inline-flex items-center gap-1 rounded-lg border border-teal-100 bg-teal-50 px-2 py-1 text-[10px] font-extrabold text-teal-800">
          <mat-icon class="text-sm">calendar_month</mat-icon>
          {{ label() }}
          @if (dayCount() > 0) {
            <span class="rounded bg-white/80 px-1 font-mono text-[9.5px]">{{ dayCount() }} {{ txt('দিন', 'd') }}</span>
          }
        </span>
      }

      @if (enabled() || !toggleable()) {
        <div class="flex flex-wrap gap-1">
          @for (preset of presets; track preset.kind) {
            <button
              type="button"
              (click)="pick(preset.kind)"
              class="cursor-pointer rounded-lg border px-2 py-1 text-[10.5px] font-bold transition-colors"
              [class]="activeKind() === preset.kind
                ? 'border-teal-300 bg-teal-50 text-teal-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'"
            >{{ txt(preset.bn, preset.en) }}</button>
          }
        </div>

        <div class="ml-auto flex flex-wrap items-center gap-1.5 max-sm:w-full">
          <label class="flex items-center gap-1 text-[10px] font-semibold text-slate-500 max-sm:min-w-0 max-sm:flex-1">
            {{ txt('থেকে', 'From') }}
            <input
              type="date"
              appDmyDate
              class="min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] focus:border-teal-500 focus:outline-none max-sm:flex-1"
              [ngModel]="from()"
              (ngModelChange)="setFrom($event)"
            />
          </label>
          <label class="flex items-center gap-1 text-[10px] font-semibold text-slate-500 max-sm:min-w-0 max-sm:flex-1">
            {{ txt('পর্যন্ত', 'To') }}
            <input
              type="date"
              appDmyDate
              class="min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] focus:border-teal-500 focus:outline-none max-sm:flex-1"
              [ngModel]="to()"
              (ngModelChange)="setTo($event)"
            />
          </label>
          @if (from() || to()) {
            <button
              type="button"
              (click)="clear()"
              class="cursor-pointer rounded-lg border border-slate-200 p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
              [title]="txt('তারিখ ফিল্টার মুছুন', 'Clear date filter')"
            >
              <mat-icon class="text-sm leading-none">close</mat-icon>
            </button>
          }
        </div>
      }
    </div>
  `
})
export class DateRangeBar {
  private readonly prefs = inject(PreferencesService);

  readonly from = input<string>('');
  readonly to = input<string>('');
  readonly toggleable = input(false);
  readonly rangeChange = output<DateRange>();

  readonly presets = DATE_RANGE_PRESETS;
  readonly enabled = computed(() => !!(this.from() || this.to()));
  readonly activeKind = computed(() => activeDateRangeKind(this.from(), this.to()));
  readonly dayCount = computed(() => rangeDayCount(this.from(), this.to()));
  readonly label = computed(() => {
    const from = dmyFromIso(this.from());
    const to = dmyFromIso(this.to());
    if (!from && !to) return this.txt('সব সময়', 'All time');
    if (from && to && from === to) return from;
    return `${from || this.txt('শুরু', 'start')} – ${to || this.txt('আজ', 'today')}`;
  });

  /** Last active window, so re-checking the toggle restores the filter instead of resetting it. */
  private readonly lastRange = signal<DateRange>(resolveDateRange('today'));

  constructor() {
    effect(() => {
      const range = { from: this.from(), to: this.to() };
      if (range.from || range.to) this.lastRange.set(range);
    });
  }

  toggleEnabled(event: Event) {
    if ((event.target as HTMLInputElement).checked) {
      this.rangeChange.emit(this.lastRange());
    } else {
      this.rangeChange.emit({ from: '', to: '' });
    }
  }

  txt(bn: string, en: string): string {
    return this.prefs.txt(bn, en);
  }

  pick(kind: Exclude<DateRangeKind, 'custom'>) {
    this.rangeChange.emit(resolveDateRange(kind));
  }

  setFrom(value: string) {
    const from = value || '';
    const to = this.to();
    this.rangeChange.emit({ from, to: from && to && from > to ? from : to });
  }

  setTo(value: string) {
    const to = value || '';
    const from = this.from();
    this.rangeChange.emit({ from: to && from && to < from ? to : from, to });
  }

  clear() {
    this.rangeChange.emit({ from: '', to: '' });
  }
}
