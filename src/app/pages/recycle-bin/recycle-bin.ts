import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DataService, RecycleEntry } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { createPager } from '../../components/table-pagination/pagination';
import { TablePagination } from '../../components/table-pagination/table-pagination';

@Component({
  selector: 'app-recycle-bin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, TablePagination],
  template: `
    <div class="space-y-4 text-xs text-slate-800">
      <div class="bg-white p-4 rounded-xl shadow-xs border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-bold text-slate-900">{{ prefs.txt('রিসাইকেল বিন', 'Recycle Bin') }}</h1>
          <p class="text-xs text-slate-500">Dashboard / Recycle Bin</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-bold">
            {{ data.recycleBin().length }} {{ prefs.txt('টি', 'items') }}
          </span>
          @if (data.recycleBin().length) {
            <button (click)="askEmpty()"
              class="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 font-bold hover:bg-rose-50 cursor-pointer">
              {{ prefs.txt('সব স্থায়ীভাবে মুছুন', 'Empty permanently') }}
            </button>
          }
        </div>
      </div>

      @if (!data.recycleBin().length) {
        <div class="bg-white p-6 rounded-xl shadow-xs border border-slate-200 text-center py-12">
          <mat-icon class="text-5xl text-slate-400 block mb-2">delete_sweep</mat-icon>
          <h3 class="font-bold text-base text-slate-800">{{ prefs.txt('রিসাইকেল বিন এখন খালি', 'Recycle Bin is empty') }}</h3>
          <p class="text-slate-500 max-w-md mx-auto mt-1">
            {{ prefs.txt('কোনো রেকর্ড মুছলে সেটি এখানে জমা থাকবে — ভুলে মুছে ফেললেও এক ক্লিকে ফিরিয়ে আনা যাবে।', 'Deleted records are kept here so a wrong delete can be undone with one click.') }}
          </p>
        </div>
      } @else {
        <div class="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-3 py-2.5 font-bold">{{ prefs.txt('ধরন', 'Type') }}</th>
                  <th class="px-3 py-2.5 font-bold">{{ prefs.txt('বিবরণ', 'Record') }}</th>
                  <th class="px-3 py-2.5 font-bold">{{ prefs.txt('মুছে ফেলার সময়', 'Deleted at') }}</th>
                  <th class="px-3 py-2.5 font-bold text-right">{{ prefs.txt('কাজ', 'Actions') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (entry of pager.paged(); track entry.id) {
                  <tr class="hover:bg-slate-50/70">
                    <td class="px-3 py-2">
                      <span class="px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 font-bold">{{ entry.kind }}</span>
                    </td>
                    <td class="px-3 py-2 font-semibold text-slate-800">{{ entry.title }}</td>
                    <td class="px-3 py-2 text-slate-500">{{ when(entry) }}</td>
                    <td class="px-3 py-2">
                      <div class="flex items-center justify-end gap-1.5">
                        <button (click)="restore(entry)"
                          class="px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold cursor-pointer">
                          {{ prefs.txt('ফিরিয়ে আনুন', 'Restore') }}
                        </button>
                        <button (click)="askPurge(entry)"
                          class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 font-bold cursor-pointer">
                          {{ prefs.txt('স্থায়ীভাবে মুছুন', 'Delete forever') }}
                        </button>
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
        </div>
        <p class="text-[11px] text-slate-500">
          {{ prefs.txt('সর্বশেষ ২০০০টি মুছে ফেলা রেকর্ড রাখা হয়। ফিরিয়ে আনলে স্টক ও খাতার হিসাবও আগের অবস্থায় ফিরে যায়।', 'The last 2000 deleted records are kept. Restoring also puts stock and ledger effects back.') }}
        </p>
      }
    </div>
  `
})
export class RecycleBin {
  readonly data = inject(DataService);
  readonly prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  readonly pager = createPager(() => this.data.recycleBin());

  restore(entry: RecycleEntry) {
    const result = this.data.restoreRecycle(entry.id);
    if (result === 'restored') {
      this.notify.success(
        this.prefs.txt(`“${entry.title}” ফিরিয়ে আনা হয়েছে।`, `“${entry.title}” was restored.`),
        this.prefs.txt('ফিরিয়ে আনা হয়েছে', 'Restored')
      );
      return;
    }
    if (result === 'duplicate') {
      this.notify.warning(
        this.prefs.txt('একই আইডির রেকর্ড এখনই ডাটাবেসে আছে — দ্বিতীয় কপি হতো, তাই ফেরানো হয়নি।', 'A record with this id already exists, so restoring would duplicate it.'),
        this.prefs.txt('ফেরানো হয়নি', 'Not restored')
      );
      return;
    }
    if (result === 'blocked') {
      this.notify.warning(this.prefs.txt('ওয়ারেন্টি স্টক বা সংযুক্ত ক্লেইমের অবস্থা মেলেনি। আগে স্টক ও মূল ক্লেইম ঠিক করুন।', 'Warranty stock or the linked claim prevents restoration. Check the stock and original claim first.'));
      return;
    }
    this.notify.error(this.prefs.txt('রেকর্ডটি পাওয়া যায়নি।', 'That record could not be found.'), 'Error');
  }

  async askPurge(entry: RecycleEntry) {
    const ok = await this.notify.confirm(
      this.prefs.txt(`“${entry.title}” স্থায়ীভাবে মুছে যাবে — এটি আর ফেরানো যাবে না।`, `“${entry.title}” will be removed. This cannot be undone.`),
      {
        title: this.prefs.txt('স্থায়ীভাবে মুছে ফেলবেন?', 'Delete permanently?'),
        confirmText: this.prefs.txt('মুছে ফেলুন', 'Delete'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (ok) this.data.purgeRecycle(entry.id);
  }

  async askEmpty() {
    const ok = await this.notify.confirm(
      this.prefs.txt('রিসাইকেল বিনের সব রেকর্ড মুছে যাবে — এটি আর ফেরানো যাবে না।', 'Every item in the recycle bin will be removed. This cannot be undone.'),
      {
        title: this.prefs.txt('সব স্থায়ীভাবে মুছবেন?', 'Empty permanently?'),
        confirmText: this.prefs.txt('সব মুছুন', 'Delete all'),
        cancelText: this.prefs.txt('বাতিল', 'Cancel')
      }
    );
    if (ok) this.data.emptyRecycle();
  }

  when(entry: RecycleEntry): string {
    const date = new Date(entry.deletedAt);
    if (Number.isNaN(date.getTime())) return entry.deletedAt;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}
