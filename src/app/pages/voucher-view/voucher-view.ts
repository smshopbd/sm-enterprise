import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';

import {
  DataService,
  Sale,
  Purchase,
  SalesReturn,
  SupplierReturn
} from '../../services/data';
import { InvoiceModal } from '../../components/invoice-modal/invoice-modal';
import { PurchaseVoucher } from '../../components/purchase-voucher/purchase-voucher';
import { ReturnNoteVoucher, ReturnNoteView } from '../../components/return-note-voucher/return-note-voucher';
import { PreferencesService } from '../../services/preferences';
import { CloudService } from '../../services/cloud';

@Component({
  selector: 'app-voucher-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, InvoiceModal, PurchaseVoucher, ReturnNoteVoucher],
  template: `
    @if (sale(); as s) {
      <app-invoice-modal [sale]="s" [viewMode]="true" (closeModal)="goHome()" />
    } @else if (purchase(); as p) {
      <app-purchase-voucher [purchase]="p" [viewMode]="true" (close)="goHome()" />
    } @else if (note(); as n) {
      <app-return-note-voucher [note]="n" [viewMode]="true" (close)="goHome()" />
    } @else if (loading()) {
      <div class="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div class="text-center">
          <div class="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600"></div>
          <p class="text-sm font-medium text-slate-500">{{ prefs.txt('ভাউচার লোড হচ্ছে…', 'Loading voucher…') }}</p>
        </div>
      </div>
    } @else {
      <div class="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div class="max-w-md w-full text-center bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
          <div class="text-4xl mb-3">🔍</div>
          <h1 class="text-lg font-bold text-slate-800 mb-2">{{ prefs.txt('ভাউচার পাওয়া যায়নি', 'Voucher not found') }}</h1>
          <p class="text-sm text-slate-500 mb-6 leading-relaxed">
            {{ prefs.txt(
              'এই লিংকের ভাউচারটি ডাটাবেসে পাওয়া যায়নি। লিংকটি পুরোনো হতে পারে, অথবা ভাউচারটি মুছে ফেলা হয়েছে।',
              'This voucher could not be found online. The link may be old, or the voucher was deleted.'
            ) }}
          </p>
          <button
            (click)="goHome()"
            class="bg-teal-600 hover:bg-teal-700 text-white font-bold px-5 py-2.5 rounded-lg cursor-pointer"
          >
            {{ prefs.txt('হোম / ড্যাশবোর্ড', 'Home / Dashboard') }}
          </button>
        </div>
      </div>
    }
  `
})
export class VoucherView implements OnInit {
  private dataService = inject(DataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cloud = inject(CloudService);
  readonly prefs = inject(PreferencesService);

  readonly sale = signal<Sale | null>(null);
  readonly purchase = signal<Purchase | null>(null);
  readonly note = signal<ReturnNoteView | null>(null);
  readonly loading = signal(false);
  /** The key on screen; a slow reply for an older link must not overwrite it. */
  private activeKey = '';

  ngOnInit() {
    this.route.paramMap.subscribe(pm => {
      const type = (pm.get('type') || '').toLowerCase();
      const key = pm.get('key') || '';
      this.sale.set(null);
      this.purchase.set(null);
      this.note.set(null);
      this.loading.set(false);
      this.activeKey = key;
      if (!key) return;

      if (type === 'sale') {
        this.sale.set(this.dataService.sales().find(s => s.shareKey === key) ?? null);
      } else if (type === 'purchase') {
        this.purchase.set(this.dataService.purchases().find(p => p.shareKey === key) ?? null);
      } else if (type === 'cr') {
        const rec = this.dataService.salesReturns().find(r => r.shareKey === key);
        if (rec) this.note.set(this.buildCrView(rec));
      } else if (type === 'dr') {
        const rec = this.dataService.supplierReturns().find(r => r.shareKey === key);
        if (rec) this.note.set(this.buildDrView(rec));
      } else {
        return;
      }

      // A scanned QR usually opens on a phone that never held the shop data,
      // so fall back to the public one-voucher lookup.
      if (!this.sale() && !this.purchase() && !this.note()) void this.loadRemote(type, key);
    });
  }

  private async loadRemote(type: string, key: string): Promise<void> {
    this.loading.set(true);
    try {
      // The visitor may carry another shop's saved config; follow this deployment.
      this.cloud.useDeploymentBackend();
      const remote = await this.cloud.fetchPublicVoucher(type, key);
      if (this.activeKey !== key) return;
      if (!remote) return;

      if (type === 'sale') {
        this.sale.set(remote as unknown as Sale);
      } else if (type === 'purchase') {
        this.purchase.set(remote as unknown as Purchase);
      } else if (type === 'cr') {
        this.note.set(this.buildCrView(remote as unknown as SalesReturn));
      } else if (type === 'dr') {
        this.note.set(this.buildDrView(remote as unknown as SupplierReturn));
      }
    } catch {
      // Treat a failed lookup as "not found": the page must never stay on the spinner.
    } finally {
      if (this.activeKey === key) this.loading.set(false);
    }
  }

  goHome() {
    this.router.navigate(['/dashboard']);
  }

  private sumSubtotal(items: { total?: number; quantity: number; unitPrice?: number }[] | undefined): number {
    return Math.round((items || []).reduce((sum, it) => sum + (it.total ?? it.quantity * (it.unitPrice ?? 0)), 0) * 100) / 100;
  }

  private buildCrView(record: SalesReturn): ReturnNoteView {
    const party = this.dataService.parties().find(p =>
      p.name.trim().toLowerCase() === (record.customerName || '').trim().toLowerCase()
    );
    const subtotal = this.sumSubtotal(record.items);
    return {
      kind: 'cr',
      sourceId: record.id,
      shareKey: record.shareKey,
      docNo: record.creditNoteNo,
      date: record.date,
      partyName: record.customerName,
      phone: party?.phone,
      address: party?.address,
      invoiceNumber: record.invoiceNumber,
      warehouse: 'SM Warehouse',
      returnedBy: record.returnedBy,
      status: record.status,
      restock: record.restock,
      reason: record.reason,
      note: record.note,
      lines: (record.items || []).map(item => ({
        productName: item.productName,
        itemCode: item.itemCode,
        quantity: item.quantity,
        unit: item.unit || 'pcs',
        unitPrice: item.unitPrice ?? 0,
        total: item.total ?? item.quantity * (item.unitPrice ?? 0)
      })),
      subtotal,
      discount: record.discountType === 'percent'
        ? Math.round(subtotal * (record.discount || 0) / 100 * 100) / 100
        : (record.discount || 0),
      shipping: record.shipping || 0,
      tax: record.taxAmount || 0,
      total: record.amount
    };
  }

  private buildDrView(record: SupplierReturn): ReturnNoteView {
    const party = this.dataService.parties().find(p => p.id === record.partyId);
    const lines = (record.items || []).map(item => ({
      productName: item.productName,
      itemCode: item.itemCode,
      quantity: item.quantity,
      unit: item.unit || 'pcs',
      unitPrice: item.unitPrice ?? 0,
      total: item.total ?? item.quantity * (item.unitPrice ?? 0)
    }));
    const subtotal = this.sumSubtotal(record.items);
    return {
      kind: 'dr',
      sourceId: record.id,
      shareKey: record.shareKey,
      docNo: record.returnNo,
      date: record.date,
      partyName: record.partyName,
      phone: party?.phone,
      address: party?.address,
      invoiceNumber: record.invoiceNumber,
      warehouse: record.warehouse,
      returnedBy: record.returnedBy,
      status: record.status,
      reason: record.reason,
      note: record.note,
      lines,
      subtotal,
      discount: record.discountType === 'percent'
        ? Math.round(subtotal * (record.discount || 0) / 100 * 100) / 100
        : (record.discount || 0),
      shipping: record.shipping || 0,
      tax: record.taxAmount || 0,
      total: record.amount
    };
  }
}
