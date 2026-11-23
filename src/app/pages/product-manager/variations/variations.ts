import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Variation } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { formatVariationValues, parseVariationValues, serializeVariationValues } from '../../../utils/variation-values';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';

@Component({
  selector: 'app-variations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination],
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">

      <!-- Hero Header -->
      <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">tune</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-teal-50/70">
                <span>{{ prefs.txt('প্রোডাক্ট ম্যানেজার', 'Product Manager') }}</span>
                <mat-icon class="text-[10px] text-teal-100/60">chevron_right</mat-icon>
                <span>{{ prefs.txt('ভ্যারিয়েশন', 'Variations') }}</span>
              </p>
              <h1 class="truncate text-xl font-bold leading-tight">{{ prefs.txt('ভ্যারিয়েশন', 'Variations') }}</h1>
              <p class="truncate text-[11px] text-teal-50/85">{{ prefs.txt('ভ্যারিয়েন্ট পণ্য তৈরির সময় ব্যবহৃত ভ্যারিয়েশন টাইপ ও তাদের মান।', 'Variation types and their values, used when building variant products.') }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="openAddModal()" class="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon class="text-sm">add_circle</mat-icon> {{ prefs.txt('নতুন ভ্যারিয়েশন যোগ করুন', 'Add New Variation') }}
            </button>
          </div>
        </div>

        <div class="relative mt-3 flex flex-wrap items-center gap-1.5">
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1 backdrop-blur-sm">
            <mat-icon class="text-xs text-teal-100">tune</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt('মোট ভ্যারিয়েশন', 'Total Variations') }}</span>
            <span class="font-mono text-[11px] font-extrabold">{{ totalVariations() }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1 backdrop-blur-sm">
            <mat-icon class="text-xs text-sky-200">sell</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt('মোট মান', 'Total Values') }}</span>
            <span class="font-mono text-[11px] font-extrabold">{{ totalValues() }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1 backdrop-blur-sm">
            <mat-icon class="text-xs text-emerald-200">check_circle</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt('ব্যবহৃত', 'In Use') }}</span>
            <span class="font-mono text-[11px] font-extrabold">{{ usedVariations() }}</span>
          </span>
        </div>
      </div>

      <!-- Table Card -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100">
          <div class="relative w-full sm:max-w-md">
            <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
            <input
              type="text"
              [placeholder]="prefs.txt('ভ্যারিয়েশন বা মান খুঁজুন...', 'Search variation or value...')"
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              class="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
            />
            @if (searchQuery()) {
              <button (click)="searchQuery.set(''); pager.setPage(1)" class="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer" [title]="prefs.txt('সার্চ মুছুন', 'Clear search')">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            }
          </div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ filteredVariations().length }} {{ prefs.txt("রেকর্ড", "records") }}</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-xs text-left border-collapse">
            <thead>
              <tr class="bg-slate-50/70">
                <th class="px-4 py-2.5 text-center w-14 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("ক্রম", "SL") }}</th>
                <th class="px-4 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("ভ্যারিয়েশন", "Variation") }}</th>
                <th class="px-4 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("মান", "Values") }}</th>
                <th class="px-4 py-2.5 text-center w-28 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("যেখানে ব্যবহৃত", "Used In") }}</th>
                <th class="px-4 py-2.5 text-center w-28 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("অ্যাকশন", "Action") }}</th>
              </tr>
            </thead>
            <tbody>
              @for (v of pager.paged(); track v.id; let idx = $index) {
                <tr class="even:bg-slate-100/60 hover:bg-teal-50/50 transition-colors align-top">
                  <td class="px-4 py-3 text-center">
                    <span class="font-mono text-[10.5px] font-semibold text-slate-500 tabular-nums">{{ pager.offset() + idx + 1 }}</span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <span class="w-8 h-8 rounded-lg bg-teal-50 border border-teal-100 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/30 dark:text-teal-300 inline-flex items-center justify-center shrink-0">
                        <mat-icon class="text-base">tune</mat-icon>
                      </span>
                      <div class="min-w-0">
                        <p class="font-bold text-slate-800 truncate">{{ v.name }}</p>
                        <p class="text-[10px] text-slate-400">{{ valueCount(v.values) }} {{ valueCount(v.values) === 1 ? prefs.txt('মান', 'value') : prefs.txt('মান', 'values') }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap items-center gap-1 max-w-xl">
                      @for (val of valuePreview(v.values); track $index) {
                        <span class="rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{{ val }}</span>
                      }
                      @if (valueCount(v.values) > 4) {
                        <span class="rounded-md bg-teal-50 border border-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">+{{ valueCount(v.values) - 4 }} {{ prefs.txt("আরও", "more") }}</span>
                      }
                      @if (!valueCount(v.values)) {
                        <span class="text-slate-400">—</span>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold border"
                      [class]="productCount(v.id) ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-slate-100 text-slate-400 border-slate-200'"
                    >
                      {{ productCount(v.id) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openEditModal(v)" class="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg cursor-pointer" [title]="prefs.txt('ভ্যারিয়েশন এডিট', 'Edit variation')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      <button (click)="deleteVariation(v)" class="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer" [title]="prefs.txt('ভ্যারিয়েশন ডিলিট', 'Delete variation')">
                        <mat-icon class="text-sm">delete</mat-icon>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="p-10 text-center">
                    <div class="flex flex-col items-center gap-1 text-slate-400">
                      <mat-icon class="text-3xl text-slate-300">tune</mat-icon>
                      <p class="font-bold text-slate-600">{{ prefs.txt("কোনো ভ্যারিয়েশন পাওয়া যায়নি", "No variations found") }}</p>
                      <p class="text-[11px]">{{ searchQuery() ? prefs.txt("অন্য সার্চ শব্দ ব্যবহার করে দেখুন।", "Try a different search term.") : prefs.txt("শুরু করতে প্রথম ভ্যারিয়েশন যোগ করুন।", "Add your first variation to get started.") }}</p>
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

        <div class="px-4 py-2.5 border-t border-slate-200 bg-slate-50/50 text-[10px] font-semibold text-slate-400 dark:bg-slate-900/40 dark:border-slate-700 dark:text-slate-500">
          {{ prefs.txt("দেখানো হচ্ছে", "Showing") }} {{ filteredVariations().length }} {{ prefs.txt("এর মধ্যে থেকে", "of") }} {{ totalVariations() }} {{ prefs.txt("ভ্যারিয়েশন", "variations") }}
        </div>
      </div>
    </div>

    <!-- Add / Edit Modal -->
    @if (showAddModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden border border-slate-200 text-slate-800 animate-in zoom-in-95 duration-200">

          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-8 h-8 rounded-lg bg-teal-50 border border-teal-100 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/30 dark:text-teal-300 inline-flex items-center justify-center">
                <mat-icon class="text-base">tune</mat-icon>
              </span>
              <div>
                <h3 class="font-bold text-sm text-slate-900">{{ isEditMode() ? prefs.txt("ভ্যারিয়েশন এডিট", "Edit Variation") : prefs.txt("নতুন ভ্যারিয়েশন যোগ করুন", "Add New Variation") }}</h3>
                <p class="text-[10.5px] text-slate-400">{{ isEditMode() ? prefs.txt("ভ্যারিয়েশন ও তার মান হালনাগাদ করুন", "Update variation and its values") : prefs.txt("মানসহ ভ্যারিয়েশন টাইপ তৈরি করুন", "Create a variation type with values") }}</p>
              </div>
            </div>
            <button (click)="showAddModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs font-sans overflow-y-auto min-h-0 flex-1">
            <div>
              <label class="block font-semibold mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("ভ্যারিয়েশনের নাম", "Variation Name") }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">tune</mat-icon>
                <input type="text" [(ngModel)]="formName" [placeholder]="prefs.txt('যেমন: Size / Color', 'e.g. Size / Color')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-900">
              </div>
            </div>

            <div class="border-t border-slate-200 pt-3">
              <div class="flex items-center justify-between mb-2">
                <label class="block font-semibold text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("ভ্যারিয়েশন মান", "Variation Values") }}</label>
                <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ filledValueCount() }} {{ filledValueCount() === 1 ? prefs.txt('মান', 'value') : prefs.txt('মান', 'values') }}</span>
              </div>

              <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
                @for (val of formValues(); track $index; let i = $index) {
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 shrink-0 rounded-md bg-slate-100 border border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 font-mono text-[10px] font-bold inline-flex items-center justify-center">{{ i + 1 }}</span>
                    <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-teal-500 flex-1">
                      <mat-icon class="text-slate-400 text-sm mr-2">sell</mat-icon>
                      <input
                        type="text"
                        [value]="val"
                        (input)="updateValueItem(i, $event)"
                        [placeholder]="prefs.txt('মান লিখুন (স্পেস অনুমোদিত)', 'Enter value (spaces allowed)')"
                        class="w-full bg-transparent outline-none text-xs font-medium text-slate-800"
                      />
                    </div>
                    <button
                      type="button"
                      (click)="removeValueItem(i)"
                      [disabled]="formValues().length === 1"
                      class="p-1.5 rounded-lg shrink-0 disabled:opacity-30 disabled:cursor-not-allowed text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                      [title]="prefs.txt('মান মুছুন', 'Remove value')"
                    >
                      <mat-icon class="text-sm">remove_circle_outline</mat-icon>
                    </button>
                  </div>
                }
              </div>

              <button
                type="button"
                (click)="addValueItem()"
                class="mt-2 w-full border-2 border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/30 rounded-xl py-2 text-slate-600 hover:text-teal-700 font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <mat-icon class="text-sm">add</mat-icon> {{ prefs.txt("নতুন মান যোগ করুন", "Add New Value") }}
              </button>
            </div>
          </div>

          <div class="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button type="button" (click)="showAddModal.set(false)" class="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer">
              {{ prefs.txt("বাতিল", "Cancel") }}
            </button>
            <button type="button" (click)="saveVariation()" class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer">
              <mat-icon class="text-sm">{{ isEditMode() ? 'save' : 'add_circle' }}</mat-icon> {{ isEditMode() ? prefs.txt("ভ্যারিয়েশন হালনাগাদ", "Update Variation") : prefs.txt("ভ্যারিয়েশন তৈরি করুন", "Create Variation") }}
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class Variations {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);

  searchQuery = signal<string>('');
  showAddModal = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  editingVariationId = signal<number | null>(null);

  formName = '';
  formValues = signal<string[]>(['']);

  filteredVariations = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const list = this.dataService.variations();
    if (!q) return list;
    return list.filter(v =>
      v.name.toLowerCase().includes(q) ||
      formatVariationValues(v.values).toLowerCase().includes(q)
    );
  });

  readonly pager = createPager(() => this.filteredVariations());

  totalVariations = computed(() => this.dataService.variations().length);
  totalValues = computed(() =>
    this.dataService.variations().reduce((total, v) => total + parseVariationValues(v.values).length, 0)
  );
  usedVariations = computed(() =>
    this.dataService.variations().filter(v => this.dataService.variationProductCount(v.id) > 0).length
  );

  filledValueCount = computed(() => this.formValues().filter(v => v.trim() !== '').length);

  valueCount(raw: string): number {
    return parseVariationValues(raw).length;
  }

  valuePreview(raw: string): string[] {
    return parseVariationValues(raw).slice(0, 4);
  }

  productCount(id: number): number {
    return this.dataService.variationProductCount(id);
  }

  onSearchInput(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  addValueItem() {
    this.formValues.update(values => [...values, '']);
  }

  removeValueItem(index: number) {
    if (this.formValues().length === 1) return;
    this.formValues.update(values => values.filter((_, i) => i !== index));
  }

  updateValueItem(index: number, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.formValues.update(values => {
      const copy = [...values];
      copy[index] = value;
      return copy;
    });
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.editingVariationId.set(null);
    this.formName = '';
    this.formValues.set(['']);
    this.showAddModal.set(true);
  }

  openEditModal(v: Variation) {
    this.isEditMode.set(true);
    this.editingVariationId.set(v.id);
    this.formName = v.name;
    const values = parseVariationValues(v.values);
    this.formValues.set(values.length ? values : ['']);
    this.showAddModal.set(true);
  }

  saveVariation() {
    const name = this.formName.trim();
    if (!name) {
      this.notify.error(this.prefs.txt('ভ্যারিয়েশনের নাম লিখুন।', 'Please enter a variation name.'), this.prefs.txt('নাম নেই', 'Missing name'));
      return;
    }

    const duplicate = this.dataService.variations().some(
      v => v.id !== this.editingVariationId() && v.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      this.notify.error(this.prefs.txt(`"${name}" ভ্যারিয়েশন আগে থেকেই আছে।`, `Variation "${name}" already exists.`), this.prefs.txt('ডুপ্লিকেট ভ্যারিয়েশন', 'Duplicate variation'));
      return;
    }

    const values = this.formValues().filter(v => v.trim() !== '');
    if (!values.length) {
      this.notify.error(this.prefs.txt('কমপক্ষে একটি ভ্যারিয়েশন মান যোগ করুন।', 'Add at least one variation value.'), this.prefs.txt('মান নেই', 'Missing values'));
      return;
    }

    const serialized = serializeVariationValues(values);

    if (this.isEditMode() && this.editingVariationId()) {
      this.dataService.updateVariation(this.editingVariationId()!, { name, values: serialized });
      this.notify.success(this.prefs.txt(`"${name}" ভ্যারিয়েশন হালনাগাদ হয়েছে।`, `Variation "${name}" updated.`), this.prefs.txt('সংরক্ষিত', 'Saved'));
    } else {
      this.dataService.addVariation({ name, values: serialized });
      this.notify.success(this.prefs.txt(`"${name}" ভ্যারিয়েশন তৈরি হয়েছে।`, `Variation "${name}" created.`), this.prefs.txt('সংরক্ষিত', 'Saved'));
    }

    this.showAddModal.set(false);
  }

  async deleteVariation(v: Variation) {
    const used = this.productCount(v.id);
    if (used > 0) {
      this.notify.error(this.prefs.txt(`"${v.name}" ভ্যারিয়েশনটি ${used}টি ভ্যারিয়েন্ট পণ্যে ব্যবহৃত হচ্ছে। ডিলিট করার আগে সেগুলো সরান।`, `"${v.name}" is used by ${used} product variant${used === 1 ? '' : 's'}. Remove those variants first.`), this.prefs.txt('ভ্যারিয়েশন ডিলিট করা যাবে না', 'Cannot delete variation'));
      return;
    }

    const confirmed = await this.notify.confirm(this.prefs.txt('এই ভ্যারিয়েশনটি ক্যাটালগ থেকে মুছে যাবে।', 'This variation will be removed from the catalogue.'), {
      title: this.prefs.txt('ভ্যারিয়েশন ডিলিট করবেন?', 'Delete variation?'),
      kind: 'error',
      confirmText: this.prefs.txt('ডিলিট', 'Delete')
    });
    if (confirmed) {
      this.dataService.deleteVariation(v.id);
      this.notify.success(this.prefs.txt(`"${v.name}" ভ্যারিয়েশন ডিলিট হয়েছে।`, `Variation "${v.name}" deleted.`));
    }
  }
}
