import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService } from '../../services/data';
import { PreferencesService } from '../../services/preferences';

/** Shared tab bar for every HRM page, with the live main balance on the right. */
@Component({
  selector: 'app-hrm-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, RouterLinkActive, MatIconModule],
  template: `
    <div class="no-print bg-white p-1.5 rounded-xl shadow-xs border border-slate-200 flex items-center justify-between gap-2">
      <div class="flex items-center gap-1 overflow-x-auto">
        @for (t of tabs(); track t.route) {
          <a
            [routerLink]="t.route"
            routerLinkActive="bg-teal-700 text-white shadow-2xs"
            [routerLinkActiveOptions]="{ exact: true }"
            class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors">
            <mat-icon class="text-sm">{{ t.icon }}</mat-icon>
            <span>{{ t.label }}</span>
          </a>
        }
      </div>
      <div class="hidden sm:flex items-center gap-2 shrink-0 pl-2">
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">
          <mat-icon class="text-sm">account_balance_wallet</mat-icon>
          {{ prefs.txt('মূল ব্যালেন্স', 'Main balance') }} ৳ {{ data.mainBalance() | number:'1.2-2' }}
        </span>
        <a routerLink="/wallet" class="text-[11px] font-bold text-teal-700 hover:underline">{{ prefs.txt('ওয়ালেট', 'Wallet') }}</a>
      </div>
    </div>
  `
})
export class HrmNav {
  data = inject(DataService);
  prefs = inject(PreferencesService);

  readonly tabs = computed(() => [
    { route: '/hrm/staff', label: this.prefs.t('nav.employees'), icon: 'badge' },
    { route: '/hrm/attendance', label: this.prefs.t('nav.attendance'), icon: 'how_to_reg' },
    { route: '/hrm/leave', label: this.prefs.t('nav.leave'), icon: 'event_busy' },
    { route: '/hrm/salary', label: this.prefs.t('nav.payroll'), icon: 'payments' },
    { route: '/hrm/staff-advance', label: this.prefs.t('nav.staffAdvance'), icon: 'handshake' },
    { route: '/hrm/rent', label: this.prefs.t('nav.shopRent'), icon: 'storefront' },
    { route: '/hrm/expenses', label: this.prefs.t('nav.dailyExpense'), icon: 'receipt_long' }
  ]);
}
