import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-generic-sales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="space-y-4 text-xs text-slate-800">
      <div class="bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <h1 class="text-xl font-bold text-slate-900 capitalize">{{ title }}</h1>
        <p class="text-xs text-slate-500">Dashboard / Sales / {{ title }}</p>
      </div>

      <div class="bg-white p-6 rounded-xl shadow-xs border border-slate-200 text-center py-12">
        <mat-icon class="text-5xl text-teal-600 block mb-2">receipt_long</mat-icon>
        <h3 class="font-bold text-base text-slate-800">{{ title }} Management</h3>
        <p class="text-slate-500 max-w-sm mx-auto mt-1">All {{ title }} records, vouchers, and statements are organized here.</p>
      </div>
    </div>
  `
})
export class GenericSales {
  private router = inject(Router);

  get title(): string {
    const url = this.router.url;
    if (url.includes('staff-advance')) return 'Staff Advance';
    if (url.includes('returns')) return 'Sales Return / Cr. Note';
    if (url.includes('payment-in')) return 'Payment In';
    if (url.includes('quotations')) return 'Quotation / Estimate';
    if (url.includes('installments')) return 'Installments';
    return 'Sales Feature';
  }
}
