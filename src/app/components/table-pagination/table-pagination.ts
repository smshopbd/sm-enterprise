import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { PAGE_SIZE_OPTIONS } from './pagination';
import { PreferencesService } from '../../services/preferences';
import { scrollToListTopAfterRender } from '../../utils/scroll-to-list-top';

type PageToken = number | 'gap';

@Component({
  selector: 'app-table-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <div
      class="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 py-2.5 border-t border-slate-200 bg-slate-50/80 text-[11px] text-slate-600 dark:bg-slate-900/40 dark:border-slate-700 dark:text-slate-300 select-none"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          {{ prefs.txt('দেখানো হচ্ছে', 'Showing') }}
          <b class="font-mono text-slate-800 dark:text-slate-100">{{ from() | number }}–{{ to() | number }}</b>
          {{ prefs.txt('/ মোট', 'of') }}
          <b class="font-mono text-slate-800 dark:text-slate-100">{{ total() | number }}</b>
        </span>

        <span class="hidden sm:inline text-slate-300 dark:text-slate-600">|</span>

        <label class="flex items-center gap-1.5">
          <span>{{ prefs.txt('প্রতি পেজে', 'Rows per page') }}</span>
          <select
            [value]="pageSize()"
            (change)="onPageSize($event)"
            [attr.aria-label]="prefs.txt('প্রতি পেজে কত রো দেখাবে', 'Rows shown on each page')"
            class="border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded-md px-1.5 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer"
          >
            @for (size of sizes; track size) {
              <option [value]="size" [selected]="size === pageSize()">{{ size | number }}</option>
            }
          </select>
          @if (prefs.language() === 'bn') {
            <span>রো</span>
          }
        </label>
      </div>

      @if (totalPages() > 1) {
        <div class="flex items-center gap-1 self-start sm:self-auto" role="navigation"
          [attr.aria-label]="prefs.txt('পেজ নেভিগেশন', 'Page navigation')">
          <button
            type="button"
            (click)="go(1)"
            [disabled]="page() <= 1"
            [title]="prefs.txt('প্রথম পেজ', 'First page')"
            [attr.aria-label]="prefs.txt('প্রথম পেজ', 'First page')"
            class="pager-btn"
          >
            <mat-icon class="text-sm">first_page</mat-icon>
          </button>
          <button
            type="button"
            (click)="go(page() - 1)"
            [disabled]="page() <= 1"
            [title]="prefs.txt('আগের পেজ', 'Previous page')"
            [attr.aria-label]="prefs.txt('আগের পেজ', 'Previous page')"
            class="pager-btn"
          >
            <mat-icon class="text-sm">chevron_left</mat-icon>
          </button>

          @for (token of tokens(); track $index) {
            @if (token === 'gap') {
              <span class="px-1 text-slate-400 dark:text-slate-500">…</span>
            } @else {
              <button
                type="button"
                (click)="go(token)"
                [attr.aria-current]="token === page() ? 'page' : null"
                class="pager-btn font-mono min-w-7"
                [class.!bg-teal-700]="token === page()"
                [class.!text-white]="token === page()"
                [class.!border-teal-600]="token === page()"
              >
                {{ token }}
              </button>
            }
          }

          <button
            type="button"
            (click)="go(page() + 1)"
            [disabled]="page() >= totalPages()"
            [title]="prefs.txt('পরের পেজ', 'Next page')"
            [attr.aria-label]="prefs.txt('পরের পেজ', 'Next page')"
            class="pager-btn"
          >
            <mat-icon class="text-sm">chevron_right</mat-icon>
          </button>
          <button
            type="button"
            (click)="go(totalPages())"
            [disabled]="page() >= totalPages()"
            [title]="prefs.txt('শেষ পেজ', 'Last page')"
            [attr.aria-label]="prefs.txt('শেষ পেজ', 'Last page')"
            class="pager-btn"
          >
            <mat-icon class="text-sm">last_page</mat-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .pager-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 1.75rem;
      min-width: 1.75rem;
      padding: 0 0.375rem;
      border-radius: 0.375rem;
      border: 1px solid var(--color-slate-300, #cbd5e1);
      background: #fff;
      color: #334155;
      font-weight: 700;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .pager-btn:hover:not(:disabled) {
      background: #f1f5f9;
    }
    .pager-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    :host-context(.dark) .pager-btn {
      background: #1e293b;
      border-color: #475569;
      color: #e2e8f0;
    }
    :host-context(.dark) .pager-btn:hover:not(:disabled) {
      background: #334155;
    }
  `
})
export class TablePagination {
  private readonly el = inject(ElementRef);
  protected readonly prefs = inject(PreferencesService);

  readonly total = input<number>(0);
  readonly page = input<number>(1);
  readonly pageSize = input<number>(25);

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  readonly sizes = PAGE_SIZE_OPTIONS;

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / Math.max(1, this.pageSize()))));
  readonly from = computed(() => (this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1));
  readonly to = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  readonly tokens = computed<PageToken[]>(() => {
    const totalPages = this.totalPages();
    const current = Math.min(Math.max(1, this.page()), totalPages);
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages = new Set<number>([1, totalPages, current]);
    if (current <= 3) {
      pages.add(2);
      pages.add(3);
      pages.add(4);
    } else if (current >= totalPages - 2) {
      pages.add(totalPages - 1);
      pages.add(totalPages - 2);
      pages.add(totalPages - 3);
    } else {
      pages.add(current - 1);
      pages.add(current + 1);
    }

    const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const tokens: PageToken[] = [];
    sorted.forEach((p, index) => {
      if (index > 0 && p - sorted[index - 1] > 1) {
        tokens.push('gap');
      }
      tokens.push(p);
    });
    return tokens;
  });

  go(page: number) {
    const target = Math.min(Math.max(1, Math.floor(page) || 1), this.totalPages());
    if (target !== this.page()) {
      this.pageChange.emit(target);
      scrollToListTopAfterRender(this.el.nativeElement);
    }
  }

  onPageSize(event: Event) {
    const value = Number((event.target as HTMLSelectElement).value);
    if (value && value !== this.pageSize()) {
      this.pageSizeChange.emit(value);
      scrollToListTopAfterRender(this.el.nativeElement);
    }
  }
}
