import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { VoucherView } from './voucher-view';
import type { Purchase, Sale } from '../../services/data';
import { DataService } from '../../services/data';
import { CloudService } from '../../services/cloud';
import { PreferencesService } from '../../services/preferences';

const localSale: Sale = {
  id: 1, invoice: 'SAL-1', shareKey: 'localkey1234', warehouse: 'SM Warehouse', date: '10-11-2026',
  customerName: 'Rahim', preparedBy: 'Admin', status: 'Completed', total: 200, paid: 200, due: 0,
  paymentStatus: 'Paid', nextPayDate: '', notes: '',
  items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 }]
};

function setup(params: Record<string, string>, cloud: { fetchPublicVoucher: (type: string, key: string) => Promise<Record<string, unknown> | null> }) {
  TestBed.configureTestingModule({ providers: [
    {
      provide: DataService, useValue: {
        sales: signal<Sale[]>([localSale]),
        purchases: signal<Purchase[]>([]),
        salesReturns: signal<never[]>([]),
        supplierReturns: signal<never[]>([]),
        parties: signal<never[]>([])
      }
    },
    { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(params)) } },
    { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
    { provide: CloudService, useValue: { useDeploymentBackend: () => undefined, fetchPublicVoucher: cloud.fetchPublicVoucher } },
    { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en } }
  ] });
  return TestBed.runInInjectionContext(() => new VoucherView());
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('VoucherView public QR page', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the sale saved on this device without asking the cloud', async () => {
    let calls = 0;
    const view = setup({ type: 'sale', key: 'localkey1234' }, {
      fetchPublicVoucher: async () => { calls++; return null; }
    });
    view.ngOnInit();
    await flush();
    expect(view.sale()?.invoice).toBe('SAL-1');
    expect(calls).toBe(0);
    expect(view.loading()).toBe(false);
  });

  it('fetches the scanned voucher from the public lookup when it is not stored locally', async () => {
    const remote = { ...localSale, invoice: 'SAL-REMOTE', shareKey: 'remotekey123' };
    let asked: [string, string] = ['', ''];
    const view = setup({ type: 'sale', key: 'remotekey123' }, {
      fetchPublicVoucher: async (type, key) => { asked = [type, key]; return remote as unknown as Record<string, unknown>; }
    });
    view.ngOnInit();
    await flush();
    expect(asked).toEqual(['sale', 'remotekey123']);
    expect(view.sale()?.invoice).toBe('SAL-REMOTE');
    expect(view.loading()).toBe(false);
  });

  it('stops loading and shows the not-found card when the lookup returns nothing', async () => {
    const view = setup({ type: 'sale', key: 'missingkey12' }, {
      fetchPublicVoucher: async () => null
    });
    view.ngOnInit();
    expect(view.loading()).toBe(true);
    await flush();
    expect(view.sale()).toBeNull();
    expect(view.loading()).toBe(false);
  });
});
