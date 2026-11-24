import { TestBed } from '@angular/core/testing';
import { InvoiceModal, planInvoicePages } from './invoice-modal';
import { CloudService } from '../../services/cloud';
import { DataService, Sale } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { StorageService } from '../../services/storage';

class ResizeObserverStub {
  observe = () => undefined;
  disconnect = () => undefined;
  unobserve = () => undefined;
}

function setup() {
  TestBed.configureTestingModule({ providers: [
    DataService,
    { provide: StorageService, useValue: { read: () => null, write: () => undefined, init: async () => undefined, onRemoteChange: () => () => undefined } },
    { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en, language: () => 'en' } },
    { provide: NotificationService, useValue: { show: () => undefined, success: () => undefined, error: () => undefined } },
    { provide: CloudService, useValue: { isEnabled: () => false } }
  ] });
  return TestBed.inject(DataService);
}

function saleWithClaim(warranty: Partial<Sale['warranty']> = {}): Sale {
  return {
    id: 1, invoice: 'INV-TEST', warehouse: 'SM Warehouse', date: '2026-11-11',
    customerName: 'Customer', preparedBy: 'Admin', status: 'Completed', total: 100,
    paid: 100, due: 0, paymentStatus: 'Paid', nextPayDate: '', notes: '',
    items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 1, unit: 'pcs', salesPrice: 100, total: 100 }],
    warranty: {
      claimNo: 'WR-001', originalInvoice: 'INV-OLD', battery: 'SF 100Ah', quantity: '1',
      receiveDate: '2026-11-11', receiptNo: 'PAY-777', oldSerial: 'OLD-SERIAL-1',
      replacementDate: '', deliveryNo: '', newSerial: '', status: 'Replaced', notes: '',
      ...warranty
    }
  };
}

describe('InvoiceModal warranty block', () => {  beforeAll(() => {
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
  });

  it('prints the intake serial as the new serial and drops the old serial row', () => {
    const data = setup();
    data.updateVoucherSettings({ warrantyNote: 'CUSTOM-WARRANTY-NOTE' });

    const fixture = TestBed.createComponent(InvoiceModal);
    fixture.componentRef.setInput('sale', saleWithClaim());
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('WARRANTY PRODUCT RECEIPT');
    expect(text).toContain('New Serial: OLD-SERIAL-1');
    expect(text).toContain('CUSTOM-WARRANTY-NOTE');
    expect(text).not.toContain('Old Serial');
    expect(text).not.toContain('Receipt No');
    expect(text).not.toContain('PAY-777');
  });

  it('shows the replacement serial instead of the intake serial when one exists', () => {
    setup();

    const fixture = TestBed.createComponent(InvoiceModal);
    fixture.componentRef.setInput('sale', saleWithClaim({ newSerial: 'NEW-SERIAL-2' }));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('New Serial: NEW-SERIAL-2');
    expect(text).not.toContain('OLD-SERIAL-1');
  });
});

describe('InvoiceModal commercial header', () => {
  beforeAll(() => {
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
  });

  function sale(overrides: Partial<Sale> = {}): Sale {
    return {
      id: 2, invoice: 'INV-COMM', warehouse: 'SM Warehouse', date: '2026-11-24',
      customerName: 'Customer', preparedBy: 'Admin', status: 'Completed', total: 100,
      paid: 100, due: 0, paymentStatus: 'Paid', nextPayDate: '', notes: '',
      items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 1, unit: 'pcs', salesPrice: 100, total: 100 }],
      ...overrides
    };
  }

  it('stamps the voucher from the remaining balance', () => {
    setup();
    const fixture = TestBed.createComponent(InvoiceModal);
    fixture.componentRef.setInput('sale', sale());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sp-stamp').textContent).toContain('PAID');
  });

  it('marks a cancelled sale and drops the payment stamp', () => {
    setup();
    const fixture = TestBed.createComponent(InvoiceModal);
    fixture.componentRef.setInput('sale', sale({ status: 'Cancelled', paid: 0, due: 100 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sp-cancelled').textContent).toContain('CANCELLED');
    expect(fixture.nativeElement.querySelector('.sp-stamp')).toBeNull();
  });

  it('labels each copy on a multi-copy sheet', () => {
    const data = setup();
    data.updateVoucherSettings({ copiesPerPage: 2 });
    const fixture = TestBed.createComponent(InvoiceModal);
    fixture.componentRef.setInput('sale', sale());
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Customer Copy');
    expect(text).toContain('Office Copy');
  });

  it('writes the total in words under the split', () => {
    setup();
    const fixture = TestBed.createComponent(InvoiceModal);
    fixture.componentRef.setInput('sale', sale());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sp-words').textContent).toContain('One Hundred');
  });
});

describe('planInvoicePages', () => {
  const rows = (count: number, height = 30) => Array.from({ length: count }, () => height);

  it('keeps a short invoice on a single sheet', () => {
    expect(planInvoicePages(rows(10), 1000, 100, 50, 200, 20)).toEqual([10]);
  });

  it('keeps a sheet that overflows by a hair instead of spilling one row', () => {
    expect(planInvoicePages(rows(40, 7.1), 1000, 100, 50, 620)).toEqual([40]);
  });

  it('fills the first sheet and lets the last one take the remainder', () => {
    expect(planInvoicePages(rows(40), 1000, 100, 50, 200, 20)).toEqual([29, 11]);
  });

  it('reserves room on the last sheet for the totals and signature tail', () => {
    expect(planInvoicePages(rows(40), 1000, 100, 50, 700, 20)).toEqual([19, 21, 0]);
  });

  it('fills the first sheet of Sale-1034 instead of leaving it half empty', () => {
    expect(planInvoicePages(rows(26, 29.1875), 1123, 292, 122, 675)).toEqual([26, 0]);
  });

  it('balances a long invoice the way the sale voucher measures it', () => {
    expect(planInvoicePages(rows(52, 29.1875), 1123, 242, 122, 655)).toEqual([24, 28, 0]);
  });

  it('adds a tail-only sheet when the closing blocks leave no room for a row', () => {
    expect(planInvoicePages(rows(1), 1000, 100, 50, 950, 20)).toEqual([1, 0]);
  });

  it('returns one closing sheet for an invoice without items', () => {
    expect(planInvoicePages([], 1000, 100, 50, 200, 20)).toEqual([0]);
  });
});
