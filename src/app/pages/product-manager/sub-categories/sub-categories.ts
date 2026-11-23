import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { DataService, SubCategory } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';
import { persistedSignal } from '../../../utils/persisted-signal';
import { IMAGE_ACCEPT, MediaService } from '../../../services/media';
import { buildSlug, normalizeSlug } from '../../../utils/slug';
import { createPager } from '../../../components/table-pagination/pagination';
import { TablePagination } from '../../../components/table-pagination/table-pagination';
import { reorderInView } from '../../../utils/reorder';

@Component({
  selector: 'app-sub-categories',
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
              <mat-icon class="text-xl">account_tree</mat-icon>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.16em] text-teal-50/80">
                <span>{{ prefs.txt("প্রোডাক্ট ম্যানেজার", "Product Manager") }}</span>
                <mat-icon class="text-[10px] text-teal-100/50">chevron_right</mat-icon>
                <span class="text-white/90">{{ prefs.txt("সাব ক্যাটাগরি", "Sub Categories") }}</span>
              </p>
              <h1 class="text-xl font-bold leading-tight">{{ prefs.txt("সাব ক্যাটাগরি", "Sub Categories") }}</h1>
              <p class="text-[11px] leading-snug text-teal-50/85">{{ prefs.txt("প্রতিটি ক্যাটাগরির ভেতরের দ্বিতীয়-স্তরের গোষ্ঠী। সাব ক্যাটাগরির নাম বদলালে সংযুক্ত পণ্যেও তা আপডেট হবে।", "Second-level groups inside each category. Renaming a sub category updates linked products.") }}</p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button (click)="exportExcel()" class="flex cursor-pointer items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition-colors hover:bg-white/20">
              <mat-icon style="font-size:15px;width:15px;height:15px;">file_download</mat-icon> {{ prefs.txt("এক্সপোর্ট", "Export") }}
            </button>
            <button (click)="openAddModal()" class="flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-black text-teal-800 shadow-sm transition-colors hover:bg-teal-50">
              <mat-icon style="font-size:15px;width:15px;height:15px;">add_circle</mat-icon> {{ prefs.txt("নতুন সাব ক্যাটাগরি যোগ করুন", "Add Sub Category") }}
            </button>
          </div>
        </div>

        <div class="relative mt-3 flex flex-wrap items-center gap-1.5">
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1">
            <mat-icon class="text-xs text-teal-100">account_tree</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt("মোট", "Total") }}</span>
            <span class="font-mono text-[11px] font-extrabold text-white">{{ totalSubCategories() }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1">
            <mat-icon class="text-xs text-emerald-200">check_circle</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt("সক্রিয়", "Enabled") }}</span>
            <span class="font-mono text-[11px] font-extrabold text-white">{{ enabledSubCategories() }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2 py-1">
            <mat-icon class="text-xs text-teal-200/70">inventory_2</mat-icon>
            <span class="text-[9px] font-bold uppercase tracking-wider text-teal-50/70">{{ prefs.txt("অব্যবহৃত", "Unused") }}</span>
            <span class="font-mono text-[11px] font-extrabold text-white">{{ unusedSubCategories() }}</span>
          </span>
        </div>
      </div>

      <!-- Table Card -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2 border-b border-slate-100">
          <div class="flex flex-col sm:flex-row gap-2 w-full lg:max-w-2xl">
            <select
              [value]="selectedParent()"
              (change)="onParentFilter($event)"
              class="border border-slate-300 rounded-lg px-2.5 py-2 bg-white font-medium text-slate-700 text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none sm:w-60"
            >
              <option value="">{{ prefs.txt("সব প্যারেন্ট ক্যাটাগরি", "All parent categories") }}</option>
              @for (c of dataService.categories(); track c.id) {
                <option [value]="c.name">{{ c.name }}</option>
              }
            </select>

            <div class="relative w-full">
              <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">search</mat-icon>
              <input
                type="text"
                [placeholder]="prefs.txt('সাব ক্যাটাগরি খুঁজুন...', 'Search sub category...')"
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
          </div>
          <div class="flex items-center gap-2 justify-between lg:justify-end">
            <span class="hidden lg:inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-slate-400">
              <mat-icon class="text-xs">drag_indicator</mat-icon> {{ prefs.txt("টেনে সাজান", "Drag to reorder") }}
            </span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ filteredSubCategories().length }} {{ prefs.txt("রেকর্ড", "records") }}</span>
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
          <table class="w-full min-w-[860px] text-xs text-left border-collapse">
            <thead>
              <tr class="bg-slate-50/70">
                <th class="px-4 py-2.5 text-center w-14 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("ক্রম", "SL") }}</th>
                <th class="px-4 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("সাব ক্যাটাগরি", "Sub Category") }}</th>
                <th class="px-4 py-2.5 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("প্যারেন্ট ক্যাটাগরি", "Parent Category") }}</th>
                <th class="px-4 py-2.5 text-center w-28 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("পণ্য", "Products") }}</th>
                <th class="px-4 py-2.5 text-center w-28 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("স্ট্যাটাস", "Status") }}</th>
                <th class="px-4 py-2.5 text-center w-28 border-b border-slate-200 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{{ prefs.txt("অ্যাকশন", "Action") }}</th>
              </tr>
            </thead>
            <tbody cdkDropList (cdkDropListDropped)="onDrop($event)">
              @for (sc of pager.paged(); track sc.id; let idx = $index) {
                <tr class="even:bg-slate-100/60 hover:bg-teal-50/50 transition-colors" cdkDrag cdkDragLockAxis="y">
                  <td class="px-4 py-3 text-center">
                    <span cdkDragHandle [title]="prefs.txt('টেনে সাজান', 'Drag to reorder')" class="inline-flex cursor-grab active:cursor-grabbing touch-none select-none items-center justify-center gap-0.5 rounded-md px-1 py-0.5 hover:bg-teal-100/70">
                      <mat-icon class="text-sm text-slate-400">drag_indicator</mat-icon>
                      <span class="font-mono text-[10.5px] font-semibold text-slate-500 tabular-nums">{{ pager.offset() + idx + 1 }}</span>
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                      @if (sc.logo) {
                        <img [src]="sc.logo" [attr.alt]="prefs.txt('সাব ক্যাটাগরি লোগো', 'Sub category logo')" class="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0" loading="lazy" decoding="async">
                      } @else {
                        <span class="w-8 h-8 rounded-lg bg-teal-50 border border-teal-100 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/30 dark:text-teal-300 inline-flex items-center justify-center shrink-0">
                          <mat-icon class="text-base">account_tree</mat-icon>
                        </span>
                      }
                      <div class="min-w-0">
                        <p class="font-bold text-slate-800 truncate">{{ sc.name }}</p>
                        <p class="text-[10px] text-slate-400 font-mono truncate">{{ sc.slug || '—' }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <span class="inline-flex items-center gap-1 font-semibold text-slate-600">
                      <mat-icon class="text-xs text-slate-400">folder</mat-icon> {{ sc.parentCategory }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold border"
                      [class]="productCount(sc.name) ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-slate-100 text-slate-400 border-slate-200'"
                    >
                      {{ productCount(sc.name) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border"
                      [class]="sc.status === 'Enabled' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'"
                    >
                      <span class="w-1.5 h-1.5 rounded-full" [class]="sc.status === 'Enabled' ? 'bg-emerald-500' : 'bg-rose-500'"></span>
                      {{ sc.status }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center justify-center gap-1">
                      <button (click)="openEditModal(sc)" class="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg cursor-pointer" [title]="prefs.txt('সাব ক্যাটাগরি এডিট', 'Edit sub category')">
                        <mat-icon class="text-sm">edit</mat-icon>
                      </button>
                      <button (click)="deleteSubCategory(sc)" class="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer" [title]="prefs.txt('সাব ক্যাটাগরি ডিলিট', 'Delete sub category')">
                        <mat-icon class="text-sm">delete</mat-icon>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="p-10 text-center">
                    <div class="flex flex-col items-center gap-1 text-slate-400">
                      <mat-icon class="text-3xl text-slate-300">account_tree</mat-icon>
                      <p class="font-bold text-slate-600">{{ prefs.txt("কোনো সাব ক্যাটাগরি পাওয়া যায়নি", "No sub categories found") }}</p>
                      <p class="text-[11px]">{{ searchQuery() || selectedParent() ? prefs.txt("অন্য ফিল্টার ব্যবহার করে দেখুন।", "Try a different filter.") : prefs.txt("শুরু করতে প্রথম সাব ক্যাটাগরি যোগ করুন।", "Add your first sub category to get started.") }}</p>
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
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" cdkDropList (cdkDropListDropped)="onDrop($event)">
              @for (sc of pager.paged(); track sc.id; let idx = $index) {
                <div class="group rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-300 hover:shadow-md transition-all" cdkDrag>
                  <div class="flex items-start justify-between gap-2">
                    @if (sc.logo) {
                      <img [src]="sc.logo" [attr.alt]="prefs.txt('সাব ক্যাটাগরি লোগো', 'Sub category logo')" class="h-16 w-16 sm:h-20 sm:w-20 rounded-xl object-contain bg-white border border-slate-200 p-1 shrink-0" loading="lazy" decoding="async">
                    } @else {
                      <span class="h-16 w-16 sm:h-20 sm:w-20 rounded-xl bg-teal-50 border border-teal-100 text-teal-700 dark:bg-teal-500/15 dark:border-teal-500/30 dark:text-teal-300 inline-flex items-center justify-center shrink-0">
                        <mat-icon class="text-3xl">account_tree</mat-icon>
                      </span>
                    }
                    <div class="flex flex-col items-end gap-1">
                      <span cdkDragHandle [title]="prefs.txt('টেনে সাজান', 'Drag to reorder')" class="inline-flex cursor-grab active:cursor-grabbing touch-none select-none items-center gap-0.5 rounded-md px-1 py-0.5 hover:bg-teal-100/70">
                        <mat-icon class="text-sm text-slate-300 group-hover:text-teal-500">drag_indicator</mat-icon>
                        <span class="font-mono text-[9px] font-bold text-slate-300">#{{ pager.offset() + idx + 1 }}</span>
                      </span>
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold border"
                        [class]="sc.status === 'Enabled' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'"
                      >
                        <span class="w-1.5 h-1.5 rounded-full" [class]="sc.status === 'Enabled' ? 'bg-emerald-500' : 'bg-rose-500'"></span>
                        {{ sc.status }}
                      </span>
                    </div>
                  </div>

                  <p class="mt-2 font-bold text-slate-800 truncate" [title]="sc.name">{{ sc.name }}</p>
                  <p class="text-[10px] text-slate-400 font-mono truncate" [title]="sc.slug || ''">{{ sc.slug || '—' }}</p>
                  <p class="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 truncate max-w-full">
                    <mat-icon class="text-xs text-slate-400 shrink-0">folder</mat-icon> <span class="truncate">{{ sc.parentCategory }}</span>
                  </p>

                  <div class="mt-2 flex items-center gap-1.5">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold border"
                      [class]="productCount(sc.name) ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-slate-100 text-slate-400 border-slate-200'"
                    >
                      {{ productCount(sc.name) }} {{ prefs.txt("পণ্য", "products") }}
                    </span>
                  </div>

                  <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-end gap-1">
                    <button (click)="openEditModal(sc)" class="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg cursor-pointer" [title]="prefs.txt('সাব ক্যাটাগরি এডিট', 'Edit sub category')">
                      <mat-icon class="text-sm">edit</mat-icon>
                    </button>
                    <button (click)="deleteSubCategory(sc)" class="p-1.5 text-rose-600 hover:bg-rose-100 rounded-lg cursor-pointer" [title]="prefs.txt('সাব ক্যাটাগরি ডিলিট', 'Delete sub category')">
                      <mat-icon class="text-sm">delete</mat-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="flex flex-col items-center gap-1 text-slate-400 py-10">
              <mat-icon class="text-3xl text-slate-300">account_tree</mat-icon>
              <p class="font-bold text-slate-600">{{ prefs.txt("কোনো সাব ক্যাটাগরি পাওয়া যায়নি", "No sub categories found") }}</p>
              <p class="text-[11px]">{{ searchQuery() || selectedParent() ? prefs.txt("অন্য ফিল্টার ব্যবহার করে দেখুন।", "Try a different filter.") : prefs.txt("শুরু করতে প্রথম সাব ক্যাটাগরি যোগ করুন।", "Add your first sub category to get started.") }}</p>
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
          {{ prefs.txt("দেখানো হচ্ছে", "Showing") }} {{ filteredSubCategories().length }} {{ prefs.txt("এর মধ্যে থেকে", "of") }} {{ totalSubCategories() }} {{ prefs.txt("সাব ক্যাটাগরি", "sub categories") }}
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
                <mat-icon class="text-base">account_tree</mat-icon>
              </span>
              <div>
                <h3 class="font-bold text-sm text-slate-900">{{ isEditMode() ? prefs.txt("সাব ক্যাটাগরি এডিট", "Edit Sub Category") : prefs.txt("নতুন সাব ক্যাটাগরি যোগ করুন", "Add Sub Category") }}</h3>
                <p class="text-[10.5px] text-slate-400">{{ isEditMode() ? prefs.txt("সাব ক্যাটাগরির তথ্য হালনাগাদ করুন", "Update sub category details") : prefs.txt("দ্বিতীয়-স্তরের পণ্য গোষ্ঠী তৈরি করুন", "Create a second-level product group") }}</p>
              </div>
            </div>
            <button (click)="showAddModal.set(false)" class="text-slate-400 hover:text-slate-600 cursor-pointer">
              <mat-icon class="text-sm">close</mat-icon>
            </button>
          </div>

          <div class="p-5 space-y-4 text-xs font-sans max-h-[70vh] overflow-y-auto min-h-0 flex-1">
            <div>
              <label class="block font-semibold mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("প্যারেন্ট ক্যাটাগরি", "Parent Category") }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">folder_open</mat-icon>
                <select [(ngModel)]="formParentCategory" class="w-full bg-transparent outline-none text-xs font-medium text-slate-800">
                  <option value="">{{ prefs.txt("প্যারেন্ট ক্যাটাগরি নির্বাচন করুন...", "Select parent category...") }}</option>
                  @for (c of dataService.categories(); track c.id) {
                    <option [value]="c.name">{{ c.name }}</option>
                  }
                </select>
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("সাব ক্যাটাগরির নাম", "Sub Category Name") }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">sell</mat-icon>
                <input type="text" [(ngModel)]="formName" (input)="onNameInput()" [placeholder]="prefs.txt('সাব ক্যাটাগরির নাম লিখুন', 'Enter sub category name')" class="w-full bg-transparent outline-none text-xs font-medium text-slate-900">
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1.5 text-slate-700"><span class="text-rose-500">*</span> {{ prefs.txt("স্লাগ", "Slug") }}</label>
              <div class="flex items-center border border-slate-300 rounded-lg px-2.5 py-2 bg-white focus-within:ring-2 focus-within:ring-teal-500">
                <mat-icon class="text-slate-400 text-sm mr-2">link</mat-icon>
                <input
                  type="text"
                  [(ngModel)]="formSlug"
                  (input)="onSlugInput()"
                  (blur)="onSlugBlur()"
                  [placeholder]="prefs.txt('নাম-থেকে-স্বয়ংক্রিয়', 'auto-generated-from-name')"
                  class="w-full bg-transparent outline-none text-xs font-mono text-slate-700"
                >
                <button type="button" (click)="regenerateSlug()" class="text-slate-400 hover:text-teal-600 px-1 cursor-pointer" [title]="prefs.txt('নাম থেকে নতুন করে তৈরি করুন', 'Regenerate from name')">
                  <mat-icon class="text-sm">refresh</mat-icon>
                </button>
              </div>
              <p class="text-[10.5px] text-slate-400 mt-1">{{ prefs.txt("নাম থেকে তৈরি হয়; ডুপ্লিকেট স্লাগে সংখ্যার সাফিক্স যোগ হয়।", "Generated from the name; duplicate slugs get a numeric suffix.") }}</p>
            </div>

            <div>
              <label class="block font-semibold mb-1.5 text-slate-700">{{ prefs.txt("স্ট্যাটাস", "Status") }}</label>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  (click)="formStatus = 'Enabled'"
                  [class]="formStatus === 'Enabled' ? 'bg-emerald-500 text-white font-bold px-4 py-2 rounded-lg shadow-xs cursor-pointer' : 'bg-white border border-slate-300 text-slate-700 font-medium px-4 py-2 rounded-lg cursor-pointer'"
                >
                  {{ prefs.txt("সক্রিয়", "Enabled") }}
                </button>
                <button
                  type="button"
                  (click)="formStatus = 'Disabled'"
                  [class]="formStatus === 'Disabled' ? 'bg-rose-500 text-white font-bold px-4 py-2 rounded-lg shadow-xs cursor-pointer' : 'bg-white border border-slate-300 text-slate-700 font-medium px-4 py-2 rounded-lg cursor-pointer'"
                >
                  {{ prefs.txt("নিষ্ক্রিয়", "Disabled") }}
                </button>
              </div>
            </div>

            <div>
              <label class="block font-semibold mb-1.5 text-slate-700">{{ prefs.txt("সাব ক্যাটাগরি লোগো", "Sub Category Logo") }} <span class="text-slate-400 font-normal">{{ prefs.txt("(ঐচ্ছিক)", "(optional)") }}</span></label>
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
            <button type="button" (click)="saveSubCategory()" class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer">
              <mat-icon class="text-sm">{{ isEditMode() ? 'save' : 'add_circle' }}</mat-icon> {{ isEditMode() ? prefs.txt("সাব ক্যাটাগরি হালনাগাদ", "Update Sub Category") : prefs.txt("সাব ক্যাটাগরি তৈরি করুন", "Create Sub Category") }}
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class SubCategories {
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);
  readonly session = inject(SessionService);
  private media = inject(MediaService);
  readonly imageAccept = IMAGE_ACCEPT;

  selectedParent = signal<string>('');
  searchQuery = signal<string>('');
  viewMode = persistedSignal<'list' | 'grid'>('sm_sub_categories_view_v2', 'grid', value => value === 'list' ? 'list' : 'grid');
  showAddModal = signal<boolean>(false);
  isEditMode = signal<boolean>(false);
  editingSubCategoryId = signal<number | null>(null);

  formParentCategory = '';
  formName = '';
  formSlug = '';
  formStatus: 'Enabled' | 'Disabled' = 'Enabled';
  formLogoPreview = signal<string>('');
  private slugTouched = false;

  filteredSubCategories = computed(() => {
    const parent = this.normalizeKey(this.selectedParent());
    const q = this.searchQuery().toLowerCase().trim();
    let list = this.dataService.subCategories();

    if (parent) list = list.filter(sc => this.normalizeKey(sc.parentCategory) === parent);
    if (q) {
      list = list.filter(sc =>
        sc.name.toLowerCase().includes(q) ||
        (sc.slug || '').toLowerCase().includes(q) ||
        sc.parentCategory.toLowerCase().includes(q)
      );
    }

    return list;
  });

  readonly pager = createPager(() => this.filteredSubCategories());

  totalSubCategories = computed(() => this.dataService.subCategories().length);
  enabledSubCategories = computed(() => this.dataService.subCategories().filter(sc => sc.status === 'Enabled').length);
  unusedSubCategories = computed(() => this.dataService.subCategories().filter(sc => this.dataService.subCategoryProductCount(sc.name) === 0).length);

  private normalizeKey(value: string | null | undefined): string {
    return (value || '').normalize('NFC').trim().toLowerCase();
  }

  productCount(name: string): number {
    return this.dataService.subCategoryProductCount(name);
  }

  exportExcel() {
    const rows = this.filteredSubCategories().map((sc, idx) => ({
      SL: idx + 1,
      'Sub Category': sc.name,
      'Parent Category': sc.parentCategory,
      Slug: sc.slug || '',
      Products: this.productCount(sc.name),
      Status: sc.status
    }));
    this.dataService.exportToExcel(rows, 'Sub_Categories_List');
  }

  onDrop(event: CdkDragDrop<SubCategory[]>) {
    this.dataService.reorderSubCategories(
      reorderInView(this.dataService.subCategories(), this.pager.paged(), event.previousIndex, event.currentIndex, sc => sc.id)
    );
  }

  onSearchInput(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
    this.pager.setPage(1);
  }

  onParentFilter(e: Event) {
    this.selectedParent.set((e.target as HTMLSelectElement).value);
    this.pager.setPage(1);
  }

  onNameInput() {
    if (!this.slugTouched) this.formSlug = buildSlug(this.formName);
  }

  onSlugInput() {
    this.slugTouched = true;
  }

  onSlugBlur() {
    this.formSlug = normalizeSlug(this.formSlug);
  }

  regenerateSlug() {
    this.formSlug = buildSlug(this.formName);
    this.slugTouched = false;
  }

  private ensureUniqueSlug(slug: string): string {
    const taken = new Set(
      this.dataService.subCategories()
        .filter(sc => sc.id !== this.editingSubCategoryId())
        .map(sc => (sc.slug || '').toLowerCase())
        .filter(Boolean)
    );
    if (!taken.has(slug)) return slug;

    let suffix = 2;
    while (taken.has(`${slug}-${suffix}`)) suffix += 1;
    return `${slug}-${suffix}`;
  }

  async onImageSelect(e: Event) {
    const picked = await this.media.pick(e, 'sub-categories', this.formName || 'sub-category');
    if (!picked.ok) {
      if (picked.error) this.notify.error(picked.error, this.prefs.txt('ছবি', 'Image'));
      return;
    }
    this.formLogoPreview.set(picked.image.ref);
    if (picked.image.note) this.notify.warning(picked.image.note, 'Cloudinary');
  }

  openAddModal() {
    this.isEditMode.set(false);
    this.editingSubCategoryId.set(null);
    this.formParentCategory = this.selectedParent() || '';
    this.formName = '';
    this.formSlug = '';
    this.formStatus = 'Enabled';
    this.formLogoPreview.set('');
    this.slugTouched = false;
    this.showAddModal.set(true);
  }

  openEditModal(sc: SubCategory) {
    this.isEditMode.set(true);
    this.editingSubCategoryId.set(sc.id);
    this.formParentCategory = sc.parentCategory;
    this.formName = sc.name;
    this.formSlug = sc.slug || buildSlug(sc.name);
    this.formStatus = sc.status || 'Enabled';
    this.formLogoPreview.set(sc.logo || '');
    this.slugTouched = true;
    this.showAddModal.set(true);
  }

  saveSubCategory() {
    const name = this.formName.trim();
    const parent = this.formParentCategory.trim();

    if (!name || !parent) {
      this.notify.error(this.prefs.txt('প্যারেন্ট ক্যাটাগরি নির্বাচন করে সাব ক্যাটাগরির নাম লিখুন।', 'Please select a parent category and enter a sub category name.'), this.prefs.txt('তথ্য নেই', 'Missing details'));
      return;
    }

    const duplicate = this.dataService.subCategories().some(
      sc => sc.id !== this.editingSubCategoryId() &&
        this.normalizeKey(sc.parentCategory) === this.normalizeKey(parent) &&
        this.normalizeKey(sc.name) === this.normalizeKey(name)
    );
    if (duplicate) {
      this.notify.error(this.prefs.txt(`"${parent}" এর অধীনে "${name}" সাব ক্যাটাগরি আগে থেকেই আছে।`, `Sub category "${name}" already exists under ${parent}.`), this.prefs.txt('ডুপ্লিকেট সাব ক্যাটাগরি', 'Duplicate sub category'));
      return;
    }

    const slug = this.ensureUniqueSlug(
      normalizeSlug(this.formSlug) || buildSlug(name) || `sub-category-${Date.now()}`
    );

    if (this.isEditMode() && this.editingSubCategoryId()) {
      this.dataService.updateSubCategory(this.editingSubCategoryId()!, {
        name,
        slug,
        parentCategory: parent,
        logo: this.formLogoPreview(),
        status: this.formStatus
      });
      this.session.log('Sub Category Updated', `${name} · ${parent}`);
      this.notify.success(this.prefs.txt(`"${name}" সাব ক্যাটাগরি হালনাগাদ হয়েছে।`, `Sub category "${name}" updated.`), this.prefs.txt('সংরক্ষিত', 'Saved'));
    } else {
      this.dataService.addSubCategory({
        name,
        slug,
        parentCategory: parent,
        logo: this.formLogoPreview(),
        productCount: 0,
        status: this.formStatus
      });
      this.session.log('Sub Category Created', `${name} · ${parent}`);
      this.notify.success(this.prefs.txt(`"${name}" সাব ক্যাটাগরি তৈরি হয়েছে।`, `Sub category "${name}" created.`), this.prefs.txt('সংরক্ষিত', 'Saved'));
    }

    this.showAddModal.set(false);
  }

  async deleteSubCategory(sc: SubCategory) {
    const used = this.productCount(sc.name);
    if (used > 0) {
      this.notify.error(this.prefs.txt(`"${sc.name}" সাব ক্যাটাগরিটি ${used}টি পণ্যে ব্যবহৃত হচ্ছে। ডিলিট করার আগে সেগুলো অন্য জায়গায় দিন।`, `"${sc.name}" is used by ${used} product${used === 1 ? '' : 's'}. Reassign them before deleting.`), this.prefs.txt('সাব ক্যাটাগরি ডিলিট করা যাবে না', 'Cannot delete sub category'));
      return;
    }

    const confirmed = await this.notify.confirm(this.prefs.txt('এই সাব ক্যাটাগরিটি ক্যাটালগ থেকে মুছে যাবে।', 'This sub category will be removed from the catalogue.'), {
      title: this.prefs.txt('সাব ক্যাটাগরি ডিলিট করবেন?', 'Delete sub category?'),
      kind: 'error',
      confirmText: this.prefs.txt('ডিলিট', 'Delete')
    });
    if (confirmed) {
      this.dataService.deleteSubCategory(sc.id);
      this.session.log('Sub Category Deleted', `${sc.name} · ${sc.parentCategory}`);
      this.notify.success(this.prefs.txt(`"${sc.name}" সাব ক্যাটাগরি ডিলিট হয়েছে।`, `Sub category "${sc.name}" deleted.`));
    }
  }
}
