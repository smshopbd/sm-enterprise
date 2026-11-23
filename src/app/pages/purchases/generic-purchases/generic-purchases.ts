import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-generic-purchases',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="space-y-4 text-xs text-slate-800">
      <div class="bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <h1 class="text-xl font-bold text-slate-900 capitalize">{{ title }}</h1>
        <p class="text-xs text-slate-500">Dashboard / Purchases / {{ title }}</p>
      </div>

      <div class="bg-white p-6 rounded-xl shadow-xs border border-slate-200 text-center py-12">
        <mat-icon class="text-5xl text-teal-600 block mb-2">shopping_bag</mat-icon>
        <h3 class="font-bold text-base text-slate-800">{{ title }} Management</h3>
        <p class="text-slate-500 max-w-sm mx-auto mt-1">All {{ title }} records, supplier debit notes, and payment vouchers are stored here.</p>
      </div>
    </div>
  `
})
export class GenericPurchases {
  private router = inject(Router);

  get title(): string {
    const url = this.router.url;
    if (url.includes('returns')) return 'Purchase Return / Dr. Note';
    if (url.includes('online-requests')) return 'Online Requests';
    if (url.includes('payment-out')) return 'Payment Out';
    return 'Purchases Feature';
  }
}
