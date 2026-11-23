import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { DataService, ProductModel } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';
import { persistedSignal } from '../../../utils/persisted-signal';
import { IMAGE_ACCEPT, MediaService } from '../../../services/media';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { reorderInView } from '../../../utils/reorder';

@Component({
  selector: 'app-models',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, TablePagination, DragDropModule],
  template: `
    <div class="space-y-4 text-xs text-slate-800 select-none">

      <!-- Hero Header -->
      <div class="relative overflow-hidden rounded-2xl border border-teal-700/40 bg-gradient-to-br from-teal-700 via-teal-600 to-teal-500 p-4 text-white shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950">
        <div class="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"></div>
        <div class="pointer-events-none absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-teal-300/10 blur-2xl"></div>

        <div class="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <mat-icon class="text-xl">directions_car</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.16em] text-teal-50/80">
                <span>{{ prefs.txt("প্রোডাক্ট ম্যানেজার", "Product Manager") }}</span>
                <mat-icon class="text-[10px] text-teal-100/50">chevron_right</mat-icon>
                <span class="text-white/90">{{ prefs.txt("প্রোডাক্ট মডেল", "Product Models") }}</span>
              </p>
              <h1 class="text-xl font-bold leading-tight">{{ prefs.txt("প্রোডাক্ট মডেল", "Product Models") }}</h1>
              <p class="text-[11px] leading-snug text-teal-50/85">{{ prefs.txt("পণ্যে ব্যবহৃত মডেল তালিকা ব্যবস্থাপনা। মডেলের নাম বদলালে সংশ্লিষ্ট সব পণ্যেও তা আপডেট হবে।", "Maintain the model directory used by products. Renaming a model updates linked products.") }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon style="font-size:15px;width:15px;height:15px;">file_download</mat-icon> {{ prefs.txt("এক্সপোর্ট", "Export") }}
            </button>
            <button (click)="openAddModal()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon style="font-size:15px;width:15px;height:15px;">add_circle</mat-icon> {{ prefs.txt("নতুন মডেল যোগ করুন", "Add New Model") }}
            </button>
          </div>
        </div>

        <div class="relative mt-3 flex flex-wrap items-center gap-1.5">
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1">
            <mat-icon class="text-xs text-teal-100">directions_car</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt("মোট মডেল", "Total Models") }}</span>
            <span class="font-mono text-[11px] font-extrabold text-white">{{ totalModels() }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1">
            <mat-icon class="text-xs text-sky-200">inventory</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt("ব্যবহৃত", "In Use") }}</span>
            <span class="font-mono text-[11px] font-extrabold text-white">{{ usedModels() }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1">
            <mat-icon class="text-xs text-teal-200/70">inventory_2</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt("অব্যবহৃত", "Unused") }}</span>
            <span class="font-mono text-[11px] font-extrabold text-white">{{ unusedModels() }}</span>
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
              [placeholder]="prefs.txt('মডেল খুঁজুন...', 'Search model...')"
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
          <div class="flex items-center gap-2 justify-between sm:justify-end">
            <span class="hidden lg:inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-slate-400">
              <mat-icon class="text-xs">drag_indicator</mat-icon> {{ prefs.txt("টেনে সাজান", "Drag to reorder") }}
            </span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ filteredModels().length }} {{ prefs.txt("রেকর্ড", "records") }}</span>
            <div class="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-0.5" role="group" [attr.aria-label]="prefs.txt('ভিউ মোড', 'View mode')">
              <button
                (click)="viewMode.set('list')"
                [class]="viewMode() === 'list' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                class="px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-xs font-bold transition-colors cursor-pointer"
                [title]="prefs.txt('তালিকা ভিউ', 'List view')"
              >
                <mat-icon class="text-sm">view_list</mat-icon>
                <span class="hidden sm:inline">{{ prefs.txt("তালিকা", "List") }}</span>
              </button>
              <button
                (click)="viewMode.set('grid')"
                [class]="viewMode() === 'grid' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                class="px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-xs font-bold transition-colors cursor-pointer"
                [title]="prefs.txt('গ্রিড ভিউ', 'Column view')"
              >
                <mat-icon class="text-sm">view_column</mat-icon>
                <span class="hidden sm:inline">{{ prefs.txt("কলাম", "Column") }}</span>
              </button>
            </div>
          </div>
        </div>

        @if (viewMode() === 'list') {
        <div class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-xs text-left border-collapse">
            <thead>
              <tr class="bg-slate-50/70">
                <th class="px-4 py-2.5 text-center w-14 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("ক্রম", "SL") }}</th>
                <th class="px-4 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("মডেল", "Model") }}</th>
                <th class="px-4 py-2.5 text-center w-32 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("পণ্য", "Products") }}</th>
                <th class="px-4 py-2.5 text-center w-28 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("অ্যাকশন", "Action") }}</th>
              </tr>
            </thead>
            <tbody cdkDropList (cdkDropListDropped)="onDrop($event)">
              @for (m of pager.paged(); track m.id; let idx = $index) {
                <tr class="even:bg-slate-100/60 hover:bg-teal-50/50 transition-colors" cdkDrag cdkDragLockAxis="y">
                  <td class="px-4 py-3 text-center">
                    <span cdkDragHandle [title]="prefs.txt('টেনে সাজান', 'Drag to reorder')" class="inline-flex cursor-grab active:cursor-grabbing touch-none select-none items-center justify-center gap-0.5 rounded-md px-1 py-0.5 hover:bg-teal-100/70">
                      <mat-icon class="text-sm text-slate-400">drag_indicator</mat-icon>
                      <span class="font-mono text-[10.5px] font-semibold text-slate-500 tabular-nums">{{ pager.offset() + idx + 1 }}</span>
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                      @if (m.logo) {
                        <img [src]="m.logo" [attr.alt]="prefs.txt('মডেল লোগো', 'Model logo')" class="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                      } @else {
                        <span class="w-8 h-8 rounded-lg bg-teal-50 border border-teal-100 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/30 dark:text-teal-300 inline-flex items-center justify-center shrink-0">
                          <mat-icon class="text-base">directions_car</mat-icon>
                        </span>
                      }
                      <span class="font-bold text-slate-800 truncate">{{ m.name }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold border"
                      [class]="productCount(m.name) ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-slate-100 text-slate-400 border-slate-200'"
                    >
                      {{ productCount(m.name) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openEditModal(m)" class="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg cursor-pointer" [attr.title]="prefs.txt('মডেল এডিট', 'Edit model')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      <button (click)="deleteModel(m)" class="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer" [attr.title]="prefs.txt('মডেল ডিলিট', 'Delete model')">
                        <mat-icon class="text-sm">delete</mat-icon>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="p-10 text-center">
                    <div class="flex flex-col items-center gap-1 text-slate-400">
                      <mat-icon class="text-3xl text-slate-300">directions_car</mat-icon>
                      <p class="font-bold text-slate-600">{{ prefs.txt("কোনো মডেল পাওয়া যায়নি", "No models found") }}</p>
                      <p class="text-[11px]">{{ searchQuery() ? prefs.txt("অন্য সার্চ শব্দ ব্যবহার করে দেখুন।", "Try a different search term.") : prefs.txt("শুরু করতে প্রথম পণ্য মডেল যোগ করুন।", "Add your first product model to get started.") }}</p>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        } @else {
        <div class="p-3 sm:p-4">
          @if (pager.total()) {
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3" cdkDropList (cdkDropListDropped)="onDrop($event)">
              @for (m of pager.paged(); track m.id; let idx = $index) {
                <div class="group rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300 hover:shadow-md transition-all" cdkDrag>
                  <div class="flex items-start justify-between gap-2">
                    @if (m.logo) {
                      <img [src]="m.logo" [attr.alt]="prefs.txt('মডেল লোগো', 'Model logo')" class="h-16 w-16 sm:h-20 sm:w-20 rounded-xl object-contain bg-white border border-slate-200 p-1 shrink-0" loading="lazy" decoding="async">
                    } @else {
                      <span class="h-16 w-16 sm:h-20 sm:w-20 rounded-xl bg-teal-50 border border-teal-100 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/30 dark:text-teal-300 inline-flex items-center justify-center shrink-0">
                        <mat-icon class="text-3xl">directions_car</mat-icon>
                      </span>
                    }
                    <span cdkDragHandle [title]="prefs.txt('টেনে সাজান', 'Drag to reorder')" class="inline-flex cursor-grab active:cursor-grabbing touch-none select-none items-center gap-0.5 rounded-md px-1 py-0.5 hover:bg-teal-100/70">
                      <mat-icon class="text-sm text-slate-300 group-hover:text-teal-500">drag_indicator</mat-icon>
                      <span class="font-mono text-[9px] font-bold text-slate-300">#{{ pager.offset() + idx + 1 }}</span>
                    </span>
                  </div>

                  <p class="mt-2 font-bold text-slate-800 truncate" [title]="m.name">{{ m.name }}</p>
                  <span
                    class="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold border"
                    [class]="productCount(m.name) ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-slate-100 text-slate-400 border-slate-200'"
                  >
                    {{ productCount(m.name) }} {{ prefs.txt("পণ্য", "products") }}
                  </span>

                  <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-end gap-1">
                    <button (click)="openEditModal(m)" class="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg cursor-pointer" [attr.title]="prefs.txt('মডেল এডিট', 'Edit model')">
                      <mat-icon class="text-sm">edit</mat-icon>
                    </button>
                    <button (click)="deleteModel(m)" class="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer" [attr.title]="prefs.txt('মডেল ডিলিট', 'Delete model')">
                      <mat-icon class="text-sm">delete</mat-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="flex flex-col items-center gap-1 text-slate-400 py-10">
              <mat-icon class="text-3xl text-slate-300">directions_car</mat-icon>
              <p class="font-bold text-slate-600">{{ prefs.txt("কোনো মডেল পাওয়া যায়নি", "No models found") }}</p>
              <p class="text-[11px]">{{ searchQuery() ? prefs.txt("অন্য সার্চ শব্দ ব্যবহার করে দেখুন।", "Try a different search term.") : prefs.txt("শুরু করতে প্রথম পণ্য মডেল যোগ করুন।", "Add your first product model to get started.") }}</p>
            </div>
          }
        </div>
        }

        <app-table-pagination
          [total]="pager.total()"
          [page]="pager.currentPage()"
          [pageSize]="pager.pageSize()"
          (pageChange)="pager.setPage($event)"
          (pageSizeChange)="pager.setPageSize($event)"
        />

        <div class="px-4 py-2.5 border-t border-slate-200 bg-slate-50/50 text-[10px] font-semibold text-slate-400 dark:bg-slate-900/40 dark:border-slate-700 dark:text-slate-500">
          {{ prefs.txt("দেখানো হচ্ছে", "Showing") }} {{ filteredModels().length }} {{ prefs.txt("/", "of") }} {{ totalModels() }} {{ prefs.txt("মডেল", "models") }}
        </div>
      </div>
    </div>

    <!-- Add / Edit Modal -->
    @if (showAddModal()) {
      <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden border border-slate-200 text-slate-800 animate-in zoom-in-95 duration-200">

          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-8 h-8 rounded-lg bg-teal-50 border border-teal-100 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/30 dark:text-teal-300 inline-flex items-center justify-center">
                <mat-icon class="text-base">directions_car</mat-icon>
              </span>
              <div>
                <h3 class="font-bold text-sm text-slate-900">{{ isEditMode() ? prefs.txt("মডেল এডিট করুন", "Edit Product Model") : prefs.txt("নতুন মডেল যোগ করুন", "Add New Product Model") }}</h3>
                <p class="text-[10.5px] text-slate-400">{{ isEditMode() ? prefs.txt("নির্বাচিত মডেলের তথ্য হালনাগাদ করুন", "Update the selected model") : prefs.txt("নতুন মডেল তৈরি করুন", "Create a new model entry") }}</p>
              </div>
            </div>
            <button (click)="showAddModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs font-sans overflow-y-auto min-h-0 flex-1">
            <div>
              <label class="block font-semibold mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("মডেলের নাম", "Model Name") }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">directions_car</mat-icon>
                <input type="text" [(ngModel)]="formName" [placeholder]="prefs.txt('যেমন: EasyBike / Motor Van', 'e.g. EasyBike / Motor Van')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-900">
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1.5 text-slate-700">{{ prefs.txt("মডেল লোগো", "Model Logo") }} <span class="text-slate-400 font-normal">{{ prefs.txt("(ঐচ্ছিক)", "(optional)") }}</span></label>
              <div class="border-2 border-dashed border-slate-200 rounded-xl p-3 flex flex-col items-center justify-center h-28 cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-all text-slate-400 hover:text-teal-600 relative w-32">
                <input type="file" (change)="onImageSelect($event)" [accept]="imageAccept" class="absolute inset-0 opacity-0 cursor-pointer">
                @if (formLogoPreview()) {
                  <img [src]="formLogoPreview()" [attr.alt]="prefs.txt('প্রিভিউ', 'Preview')" class="w-full h-full object-cover rounded-lg" loading="lazy" decoding="async">
                } @else {
                  <mat-icon class="text-2xl">add_photo_alternate</mat-icon>
                  <span class="text-[11px] font-medium mt-1">{{ prefs.txt("আপলোড", "Upload") }}</span>
                }
              </div>
              <p class="text-[10.5px] text-slate-400 mt-1.5">{{ prefs.txt("যেকোনো ছবি ফরম্যাট · সর্বোচ্চ 10 MB", "Any image format · max 10 MB") }}</p>
            </div>
          </div>

          <div class="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
            <button type="button" (click)="showAddModal.set(false)" class="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold px-4 py-2 rounded-lg text-xs transition-colors cursor-pointer">
              {{ prefs.txt("বাতিল", "Cancel") }}
            </button>
            <button type="button" (click)="saveModel()" class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer">
              <mat-icon class="text-sm">{{ isEditMode() ? 'save' : 'add_circle' }}</mat-icon> {{ isEditMode() ? prefs.txt("মডেল হালনাগাদ", "Update Model") : prefs.txt("মডেল তৈরি করুন", "Create Model") }}
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class Models {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);
  readonly session = inject(SessionService);
  private media = inject(MediaService);
  readonly imageAccept = IMAGE_ACCEPT;

  searchQuery = signal<string>('');
  viewMode = persistedSignal<'list' | 'grid'>('sm_models_view_v2', 'grid', value => value === 'list' ? 'list' : 'grid');
  showAddModal = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  editingModelId = signal<number | null>(null);

  formName = '';
  formLogoPreview = signal<string>('');

  filteredModels = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const list = this.dataService.productModels();
    return q ? list.filter(m => m.name.toLowerCase().includes(q)) : list;
  });

  readonly pager = createPager(() => this.filteredModels());

  totalModels = computed(() => this.dataService.productModels().length);
  usedModels = computed(() => this.dataService.productModels().filter(m => this.dataService.modelProductCount(m.name) > 0).length);
  unusedModels = computed(() => this.totalModels() - this.usedModels());

  productCount(name: string): number {
    return this.dataService.modelProductCount(name);
  }

  exportExcel() {
    const rows = this.filteredModels().map((m, idx) => ({
      SL: idx + 1,
      Model: m.name,
      Products: this.productCount(m.name)
    }));
    this.dataService.exportToExcel(rows, 'Product_Models_List');
  }

  onDrop(event: CdkDragDrop<ProductModel[]>) {
    this.dataService.reorderProductModels(
      reorderInView(this.dataService.productModels(), this.pager.paged(), event.previousIndex, event.currentIndex, m => m.id)
    );
  }

  onSearchInput(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  async onImageSelect(e: Event) {
    const picked = await this.media.pick(e, 'models', this.formName || 'model');
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, this.prefs.txt('ছবি', 'Image'));
      return;
    }
    this.formLogoPreview.set(picked.image.ref);
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.editingModelId.set(null);
    this.formName = '';
    this.formLogoPreview.set('');
    this.showAddModal.set(true);
  }

  openEditModal(m: ProductModel) {
    this.isEditMode.set(true);
    this.editingModelId.set(m.id);
    this.formName = m.name;
    this.formLogoPreview.set(m.logo || '');
    this.showAddModal.set(true);
  }

  saveModel() {
    const name = this.formName.trim();
    if (!name) {
      this.notify.error(this.prefs.txt('মডেলের নাম লিখুন।', 'Please enter a model name.'), this.prefs.txt('নাম নেই', 'Missing name'));
      return;
    }

    const duplicate = this.dataService.productModels().some(
      m => m.id !== this.editingModelId() && m.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      this.notify.error(this.prefs.txt(`"${name}" মডেল আগে থেকেই আছে।`, `Model "${name}" already exists.`), this.prefs.txt('ডুপ্লিকেট মডেল', 'Duplicate model'));
      return;
    }

    if (this.isEditMode() && this.editingModelId()) {
      this.dataService.updateProductModel(this.editingModelId()!, { name, logo: this.formLogoPreview() });
      this.session.log('Model Updated', name);
      this.notify.success(this.prefs.txt(`"${name}" মডেল হালনাগাদ হয়েছে।`, `Model "${name}" updated.`), this.prefs.txt('সংরক্ষিত', 'Saved'));
    } else {
      this.dataService.addProductModel({ name, logo: this.formLogoPreview() });
      this.session.log('Model Created', name);
      this.notify.success(this.prefs.txt(`"${name}" মডেল তৈরি হয়েছে।`, `Model "${name}" created.`), this.prefs.txt('সংরক্ষিত', 'Saved'));
    }

    this.showAddModal.set(false);
  }

  async deleteModel(m: ProductModel) {
    const used = this.productCount(m.name);
    if (used > 0) {
      this.notify.error(this.prefs.txt(`"${m.name}" মডেলটি ${used}টি পণ্যে ব্যবহৃত হচ্ছে। ডিলিট করার আগে সেগুলো অন্য মডেলে দিন।`, `"${m.name}" is used by ${used} product${used === 1 ? '' : 's'}. Reassign them before deleting.`), this.prefs.txt('মডেল ডিলিট করা যাবে না', 'Cannot delete model'));
      return;
    }

    const confirmed = await this.notify.confirm(this.prefs.txt('এই মডেলটি ক্যাটালগ থেকে মুছে যাবে।', 'This model will be removed from the catalogue.'), {
      title: this.prefs.txt('মডেল ডিলিট করবেন?', 'Delete model?'),
      kind: 'error',
      confirmText: this.prefs.txt('ডিলিট', 'Delete')
    });
    if (confirmed) {
      this.dataService.deleteProductModel(m.id);
      this.session.log('Model Deleted', m.name);
      this.notify.success(this.prefs.txt(`"${m.name}" মডেল ডিলিট হয়েছে।`, `Model "${m.name}" deleted.`));
    }
  }
}
