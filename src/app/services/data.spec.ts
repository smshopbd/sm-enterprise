import { TestBed } from '@angular/core/testing';
import { accountOf, BatteryVoucher, DataService, HrmLeave, HrmStaff, Party, partyPhoneKey, partyPhones, Product, promiseRemaining, Purchase, Sale, SalesReturn, SupplierReturn, VoucherSettings, WalletTransaction } from './data';
import { localDateIso } from '../utils/local-date';
import { buildWarrantyRegister } from '../utils/warranty';
import { CloudService } from './cloud';
import { NotificationService } from './notification';
import { PreferencesService } from './preferences';
import { StorageService } from './storage';

function setup() {
  const writes = new Map<string, unknown>();
  TestBed.configureTestingModule({ providers: [
    DataService,
    { provide: StorageService, useValue: { read: () => null, write: (key: string, value: unknown) => writes.set(key, value), init: async () => undefined, onRemoteChange: () => () => undefined } },
    { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en } },
    { provide: NotificationService, useValue: { show: () => undefined, success: () => undefined, error: () => undefined } },
    { provide: CloudService, useValue: { isEnabled: () => false } }
  ] });
  return { data: TestBed.inject(DataService), writes };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 10, name: 'Battery', code: 'B10', rack: '', warehouse: 'SM Warehouse', type: 'single',
    category: '', brand: '', model: '', stock: 5, unit: 'pcs', salesPrice: 100, purchasePrice: 80,
    wholesalePrice: 90, ...overrides
  };
}

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: 1, name: 'Customer', companyName: '', type: 'Customer', total: 0, paid: 0, due: 0,
    salesTotal: 0, salesPaid: 0, salesDue: 0, salesAdvance: 0,
    purchaseTotal: 0, purchasePaid: 0, purchaseDue: 0, purchaseAdvance: 0,
    status: 'Enabled', inHand: '', zone: '', email: '', createdAt: '2026-11-11', address: '', ...overrides
  };
}

function sale(data: DataService, overrides: Partial<Omit<Sale, 'id'>> = {}): Sale {
  const quantity = overrides.items?.[0]?.quantity ?? 1;
  return data.addSale({
    invoice: `Sale-${9000 + data.sales().length}`, warehouse: 'SM Warehouse', date: '2026-11-11',
    customerName: 'Customer', preparedBy: 'Admin', status: 'Completed', total: quantity * 100, paid: 0,
    due: 0, paymentStatus: 'Unpaid', nextPayDate: '', notes: '',
    items: [{ id: 1, productId: 10, productName: 'Battery', quantity, unit: 'pcs', salesPrice: 100, total: quantity * 100 }],
    ...overrides
  });
}

function purchase(data: DataService, overrides: Partial<Omit<Purchase, 'id'>> = {}): Purchase {
  return data.recordPurchase({
    invoice: `PUR-${9000 + data.purchases().length}`, warehouse: 'SM Warehouse', date: '2026-11-11',
    supplierName: 'Supplier', preparedBy: 'Admin', status: 'Received', total: 160, paid: 0, due: 160,
    paymentStatus: 'Unpaid', nextPayDate: '', notes: '',
    items: [{ id: 1, productId: 10, productName: 'Battery', itemCode: 'B10', unit: 'pcs', quantity: 2, purchasePrice: 80, subtotal: 160 }],
    ...overrides
  });
}

function credit(data: DataService, overrides: Partial<Omit<SalesReturn, 'id' | 'creditNoteNo' | 'createdAt'>> = {}): SalesReturn {
  return data.recordSalesReturn({
    date: '2026-11-11', invoiceNumber: 'Sale-9000', customerName: 'Customer', items: [], amount: 20,
    reason: '', restock: false, status: 'Posted', ...overrides
  });
}

function supplierReturn(data: DataService, overrides: Partial<SupplierReturn> & { partyId?: number } = {}): SupplierReturn {
  return data.recordSupplierReturn({
    partyId: overrides.partyId ?? 2, partyName: 'Supplier', amount: 20, date: '2026-11-11', note: '',
    items: [{ productId: 10, productName: 'Battery', quantity: 2, unit: 'pcs' }], status: 'Completed', ...overrides
  });
}

describe('DataService inventory and ledger lifecycles', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('rejects aggregate variant oversell before any sale, stock or party mutation', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', stock: 5, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 },
      { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 3 }
    ] })]);
    data.parties.set([party()]);
    expect(() => sale(data, { items: [
      { id: 1, productId: 10, variantId: 1, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 },
      { id: 2, productId: 10, variantId: 1, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 }
    ], total: 400 })).toThrow('Insufficient variant stock');
    expect(data.sales()).toHaveLength(0);
    expect(data.products()[0].stock).toBe(5);
    expect(data.products()[0].variants![0].openingStock).toBe(2);
    expect(accountOf(data.parties()[0], 'sales').due).toBe(0);
  });

  it('rejects variant lines whose sum exceeds the parent stock', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', stock: 3, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 },
      { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 }
    ] })]);
    expect(() => sale(data, { items: [
      { id: 1, productId: 10, variantId: 1, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 },
      { id: 2, productId: 10, variantId: 2, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 }
    ], total: 400 })).toThrow('Insufficient stock');
    expect(data.products()[0].stock).toBe(3);
  });

  it('decrements both parent and selected variant stock on a valid sale', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', stock: 5, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 },
      { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 3 }
    ] })]);
    sale(data, { items: [
      { id: 1, productId: 10, variantId: 1, productName: 'Battery', quantity: 1, unit: 'pcs', salesPrice: 100, total: 100 },
      { id: 2, productId: 10, variantId: 2, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 }
    ], total: 300 });
    expect(data.products()[0].stock).toBe(2);
    expect(data.products()[0].variants!.map(v => v.openingStock)).toEqual([1, 1]);
  });

  it('blocks activating a pending sale that would oversell current stock', () => {
    const { data } = setup();
    data.products.set([product({ stock: 1 })]);
    const pending = sale(data, { status: 'Ordered' });
    sale(data);
    expect(data.products()[0].stock).toBe(0);
    expect(() => data.updateSaleStatus(pending.id, 'Completed')).toThrow('Insufficient stock');
    expect(data.sales().find(s => s.id === pending.id)!.status).toBe('Ordered');
    expect(data.products()[0].stock).toBe(0);
  });

  it('blocks deleting a received purchase whose stock was already sold', () => {
    const { data } = setup();
    data.products.set([product({ stock: 0 })]);
    const received = purchase(data);
    sale(data, { items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 }], total: 200 });
    expect(data.products()[0].stock).toBe(0);
    expect(() => data.deletePurchase(received.id)).toThrow('Insufficient stock');
    expect(data.purchases()).toHaveLength(1);
    expect(data.products()[0].stock).toBe(0);
  });

  it('refuses a received purchase line whose product is missing instead of silently dropping stock', () => {
    const { data } = setup();
    data.products.set([product()]);
    expect(() => purchase(data, {
      items: [{ id: 1, productId: 999, productName: 'Missing washer', itemCode: 'W10', unit: 'pcs', quantity: 10, purchasePrice: 150, subtotal: 1500 }]
    })).toThrow('পণ্য পাওয়া যায়নি');
    expect(data.purchases()).toHaveLength(0);
    expect(data.products()[0].stock).toBe(5);
  });

  it('links a purchase line to a recreated product by its item code', () => {
    const { data } = setup();
    data.products.set([product({ id: 77, code: 'W10', stock: 0 })]);
    purchase(data, {
      items: [{ id: 1, productId: 12, productName: 'Old washer', itemCode: 'W10', unit: 'pcs', quantity: 10, purchasePrice: 150, subtotal: 1500 }]
    });
    expect(data.products()[0].stock).toBe(10);
  });

  it('sets the product cost to the rate a received purchase was bought at', () => {
    const { data } = setup();
    data.products.set([product({ purchasePrice: 80 })]);
    purchase(data, {
      items: [{ id: 1, productId: 10, productName: 'Battery', itemCode: 'B10', unit: 'pcs', quantity: 3, purchasePrice: 95.5, subtotal: 286.5 }]
    });
    expect(data.products()[0].purchasePrice).toBe(95.5);
  });

  it('leaves the product cost alone for a purchase that is not received', () => {
    const { data } = setup();
    data.products.set([product({ purchasePrice: 80 })]);
    purchase(data, {
      status: 'Pending',
      items: [{ id: 1, productId: 10, productName: 'Battery', itemCode: 'B10', unit: 'pcs', quantity: 3, purchasePrice: 120, subtotal: 360 }]
    });
    expect(data.products()[0].purchasePrice).toBe(80);
  });

  it('updates variant cost from the bought variant and keeps the parent at the cheapest rate', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', purchasePrice: 80, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 },
      { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B', purchasePrice: 90, wholesalePrice: 95, salesPrice: 105, openingStock: 2 }
    ] })]);
    purchase(data, {
      items: [{ id: 1, productId: 10, variantId: 1, variantValue: 'A', productName: 'Battery', itemCode: 'A', unit: 'pcs', quantity: 2, purchasePrice: 70, subtotal: 140 }]
    });
    expect(data.products()[0].variants![0].purchasePrice).toBe(70);
    expect(data.products()[0].variants![1].purchasePrice).toBe(90);
    expect(data.products()[0].purchasePrice).toBe(70);
  });

  it('does not re-post party money when only a purchase date changes', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party({ id: 2, name: 'Supplier', type: 'Supplier', roles: ['Supplier'], purchaseDue: 500 })]);
    const received = purchase(data);
    const partyBefore = data.parties()[0];
    expect(data.partyOpeningBalance(partyBefore, 'purchase')).toBe(500);

    data.updatePurchase(received.id, { ...received, date: '2026-11-01' });

    expect(data.purchases()[0].date).toBe('2026-11-01');
    expect(data.parties()[0]).toBe(partyBefore);
    expect(data.partyOpeningBalance(data.parties()[0], 'purchase')).toBe(500);
  });

  it('posts only the changed money when a purchase amount is edited', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party({ id: 2, name: 'Supplier', type: 'Supplier', roles: ['Supplier'], purchaseDue: 500 })]);
    const received = purchase(data);

    data.updatePurchase(received.id, { ...received, total: 200, paid: 40, due: 160 });

    expect(data.parties()[0].purchaseTotal).toBe(200);
    expect(data.parties()[0].purchasePaid).toBe(40);
    expect(data.parties()[0].purchaseDue).toBe(660);
    expect(data.partyOpeningBalance(data.parties()[0], 'purchase')).toBe(500);
  });

  it('starts the purchase voucher book at PUR-3001 and counts up from there', () => {
    const { data } = setup();
    data.products.set([product()]);
    expect(data.nextPurchaseInvoice()).toBe('PUR-3001');
    purchase(data, { invoice: 'PUR-3004' });
    expect(data.nextPurchaseInvoice()).toBe('PUR-3005');
  });

  it('ignores old five-digit purchase numbers when numbering fresh vouchers', () => {
    const { data } = setup();
    data.products.set([product()]);
    purchase(data, { invoice: 'PUR-30903' });
    expect(data.nextPurchaseInvoice()).toBe('PUR-3001');
  });

  it('keeps credit-note settlement in invoice and party due after a note-only sale edit', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party()]);
    const original = sale(data, { total: 100 });
    credit(data, { invoiceNumber: original.invoice, partyId: 1, amount: 20 });
    expect(data.sales()[0].due).toBe(80);
    expect(accountOf(data.parties()[0], 'sales').due).toBe(80);
    const edited = data.updateSale(original.id, { ...original, notes: 'Edited note only' });
    expect(edited.due).toBe(80);
    expect(accountOf(data.parties()[0], 'sales').due).toBe(80);
  });

  it('preserves POS-only fields when a sale is edited through a narrower form', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    const original = sale(data, {
      total: 118, memoNote: 'Deliver after 5pm', taxAmount: 11, damageAmount: 7,
      paymentMode: 'bKash', warehouse: 'Branch', mechanic: 'Rahim'
    });
    const payload: Partial<Sale> = { ...original };
    delete payload.id;
    delete payload.memoNote;
    delete payload.taxAmount;
    delete payload.damageAmount;
    delete payload.paymentMode;
    delete payload.mechanic;

    const edited = data.updateSale(original.id, payload as Omit<Sale, 'id'>);
    expect(edited).toMatchObject({
      memoNote: 'Deliver after 5pm', taxAmount: 11, damageAmount: 7,
      paymentMode: 'bKash', warehouse: 'Branch', mechanic: 'Rahim'
    });
  });

  it('reverses a sale against the stable party id after the party is renamed', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party({ name: 'Old name' })]);
    const created = sale(data, { customerName: 'Old name', total: 100 });
    expect(created.partyId).toBe(1);
    expect(accountOf(data.parties()[0], 'sales').due).toBe(100);
    data.updateParty({ ...data.parties()[0], name: 'New name' });
    data.deleteSale(created.id);
    expect(data.sales()).toHaveLength(0);
    expect(accountOf(data.parties()[0], 'sales').due).toBe(0);
  });

  it('credits only the selected party when duplicate customer names exist', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party({ id: 1, name: 'Same name' }), party({ id: 2, name: 'Same name' })]);
    const created = sale(data, { customerName: 'Same name', partyId: 1, total: 50 });
    credit(data, { invoiceNumber: created.invoice, customerName: 'Same name', partyId: 1, amount: 20 });
    expect(accountOf(data.parties().find(p => p.id === 1)!, 'sales').due).toBe(30);
    expect(accountOf(data.parties().find(p => p.id === 2)!, 'sales').due).toBe(0);
    expect(data.sales()[0].due).toBe(30);
  });

  it('restores a draft supplier return as paperwork only, then posts when completed', () => {
    const { data } = setup();
    data.products.set([product({ stock: 5 })]);
    data.parties.set([party({ id: 2, name: 'Supplier', type: 'Supplier' })]);
    const draft = supplierReturn(data, { status: 'Draft' });
    data.supplierReturns.set([]);
    data.products.set([product({ stock: 5 })]);
    data.recycleBin.set([{ id: data.newId(), collection: 'sm_supplier_returns_v1', kind: 'ডেবিট নোট', title: draft.returnNo, recordId: draft.id, deletedAt: '2026-11-11', payload: draft }]);
    expect(data.restoreRecycle(data.recycleBin()[0].id)).toBe('restored');
    expect(data.products()[0].stock).toBe(5);
    expect(accountOf(data.parties()[0], 'purchase').due).toBe(0);
    data.updateSupplierReturn(draft.id, { status: 'Completed' });
    expect(data.products()[0].stock).toBe(3);
    expect(accountOf(data.parties()[0], 'purchase').due).toBe(-20);
  });

  it('blocks a supplier return edit that would return more stock than remains', () => {
    const { data } = setup();
    data.products.set([product({ stock: 1 })]);
    data.parties.set([party({ id: 2, name: 'Supplier', type: 'Supplier' })]);
    const note = supplierReturn(data, { items: [{ productId: 10, productName: 'Battery', quantity: 1, unit: 'pcs' }], amount: 10 });
    expect(data.products()[0].stock).toBe(0);
    expect(() => data.updateSupplierReturn(note.id, { items: [{ productId: 10, productName: 'Battery', quantity: 2, unit: 'pcs' }], amount: 20 })).toThrow('Insufficient stock');
    expect(data.products()[0].stock).toBe(0);
    expect(data.supplierReturns()[0].amount).toBe(10);
  });
});

describe('Sale voucher serial', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts a fresh shop at Sale-1001 and continues in order', () => {
    const { data } = setup();
    expect(data.peekSaleVoucherNo()).toBe('Sale-1001');
    data.sales.set([{ invoice: 'Sale-1001' } as Sale]);
    expect(data.peekSaleVoucherNo()).toBe('Sale-1002');
  });

  it('never reuses a number already in the shop', () => {
    const { data } = setup();
    data.sales.set([{ invoice: 'Sale-1042' } as Sale]);
    expect(data.peekSaleVoucherNo()).toBe('Sale-1043');
  });

  it('moves a bill saved with a number another device already took', () => {
    const { data } = setup();
    data.products.set([product({ stock: 5 })]);
    data.sales.set([{ invoice: 'Sale-1001' } as Sale]);
    const saved = sale(data, { invoice: 'Sale-1001' });
    expect(saved.invoice).toBe('Sale-1002');
    expect(data.peekSaleVoucherNo()).toBe('Sale-1003');
  });
});

describe('Unit management persistence', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('writes the added unit into the sm_units_v1 collection', async () => {
    const { data, writes } = setup();
    await data.initDatabase();
    expect(data.addUnit('লিটার').ok).toBe(true);
    TestBed.tick();
    const saved = writes.get('sm_units_v1') as { name: string }[] | undefined;
    expect(saved?.some(unit => unit.name === 'লিটার')).toBe(true);
  });
});

describe('POS QR switch', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('defaults to on for settings saved before the switch existed', () => {
    const { data } = setup();
    const legacy: Partial<VoucherSettings> = { ...data.defaultVoucherSettings };
    delete legacy.showPosQrCode;
    expect(data.normalizeVoucherSettings(legacy as VoucherSettings).showPosQrCode).toBe(true);
  });

  it('persists the POS QR toggle in the voucher settings store', async () => {
    const { data, writes } = setup();
    await data.initDatabase();
    data.updateVoucherSettings({ showPosQrCode: false });
    TestBed.tick();
    const saved = writes.get('sm_voucher_settings_v2') as { showPosQrCode?: boolean } | undefined;
    expect(saved?.showPosQrCode).toBe(false);
  });
});

describe('QR mode', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('defaults settings saved before the switch existed to the link QR', () => {
    const { data } = setup();
    const legacy: Partial<VoucherSettings> = { ...data.defaultVoucherSettings };
    delete legacy.qrMode;
    expect(data.normalizeVoucherSettings(legacy as VoucherSettings).qrMode).toBe('link');
  });

  it('keeps a saved text QR choice', () => {
    const { data } = setup();
    expect(data.normalizeVoucherSettings({ ...data.defaultVoucherSettings, qrMode: 'text' }).qrMode).toBe('text');
  });
});

describe('Voucher column borders', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('defaults to on for settings saved before the switch existed', () => {
    const { data } = setup();
    const legacy: Partial<VoucherSettings> = { ...data.defaultVoucherSettings };
    delete legacy.showColumnBorders;
    expect(data.normalizeVoucherSettings(legacy as VoucherSettings).showColumnBorders).toBe(true);
  });
});

describe('Owner edit locks', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('defaults both locks to off for settings saved before the switches existed', () => {
    const { data } = setup();
    const legacy: Partial<VoucherSettings> = { ...data.defaultVoucherSettings };
    delete legacy.lockPartyMoney;
    delete legacy.lockStock;
    const normalized = data.normalizeVoucherSettings(legacy as VoucherSettings);
    expect(normalized.lockPartyMoney).toBe(false);
    expect(normalized.lockStock).toBe(false);
  });

  it('keeps a lock the owner turned on', () => {
    const { data } = setup();
    const normalized = data.normalizeVoucherSettings({
      ...data.defaultVoucherSettings, lockPartyMoney: true, lockStock: true
    });
    expect(normalized.lockPartyMoney).toBe(true);
    expect(normalized.lockStock).toBe(true);
  });
});

describe('Wallet transaction serial', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts at WLT-1001 and continues without a reserved-block gap', () => {
    const { data } = setup();
    const account = data.walletAccounts()[0];
    const first = data.addWalletTransaction({ date: '2026-11-14', direction: 'In', accountId: account.id, amount: 250.239, party: 'Karim', note: '' });
    const second = data.addWalletTransaction({ date: '2026-11-14', direction: 'In', accountId: account.id, amount: 100, party: '', note: '' });
    expect(first.txnNo).toBe('WLT-1001');
    expect(second.txnNo).toBe('WLT-1002');
    expect(first.amount).toBe(250.24);
    expect(data.walletBalance(account.id)).toBe(350.24);
  });

  it('skips a number another device already saved', () => {
    const { data } = setup();
    const account = data.walletAccounts()[0];
    data.walletTransactions.set([{ id: 1, txnNo: 'WLT-1001' } as WalletTransaction]);
    const saved = data.addWalletTransaction({ date: '2026-11-14', direction: 'In', accountId: account.id, amount: 10, party: '', note: '' });
    expect(saved.txnNo).toBe('WLT-1002');
  });
});

describe('Battery wallet posting', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('tags the money rows to the voucher and reverses them when it goes', () => {
    const { data } = setup();
    const voucher = data.addBatteryVoucher({
      type: 'sale', date: '2026-11-14', partyName: 'Karim', lot: '', lines: [],
      totalKg: 1, total: 800, cost: 600, cash: 500, bank: 0, mobile: 300, mobileType: 'bKash',
      ref: '', paid: 800, due: 0, notes: '', preparedBy: 'Admin', createdAt: new Date().toISOString()
    });
    const rows = data.walletTransactions();
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.source === 'Battery' && r.refId === voucher.id && r.direction === 'In')).toBe(true);
    expect(rows.map(r => r.amount).sort((a, b) => a - b)).toEqual([300, 500]);
    expect(data.walletTxnLinkedToDocument(rows[0])).toBe(true);

    data.deleteBatteryVoucher(voucher.id);
    expect(data.walletTransactions()).toHaveLength(0);
  });

  it('treats rows saved before the source tag as voucher-owned', () => {
    const { data } = setup();
    data.batteryVouchers.set([{ id: 77, walletTxnIds: [5] } as BatteryVoucher]);
    data.walletTransactions.set([{
      id: 5, txnNo: 'WLT-1001', date: '2026-11-14', direction: 'In',
      accountId: data.walletAccounts()[0].id, amount: 10, party: '', note: '', createdAt: ''
    }]);
    expect(data.walletTxnOwnedByBattery(5)).toBe(true);
    expect(data.walletTxnLinkedToDocument(data.walletTransactions()[0])).toBe(true);
    expect(data.walletAccountLinkedTxns(data.walletAccounts()[0].id)).toHaveLength(1);
  });

  it('refuses to post an expense to an account that no longer exists', () => {
    const { data } = setup();
    const record = data.addExpense({ title: 'Cha', amount: 20, category: 'Expense', date: '2026-11-14', note: '', accountId: 999 });
    expect(record.walletTxnId).toBeUndefined();
    expect(data.walletTransactions()).toHaveLength(0);
    expect(data.walletBalance(data.walletAccounts()[0].id)).toBe(0);
  });
});

describe('Battery voucher party ledger', () => {
  afterEach(() => TestBed.resetTestingModule());

  const payload = (partyId: number, overrides: Partial<Omit<BatteryVoucher, 'id' | 'voucherNo'>> = {}) => ({
    type: 'purchase' as const, date: '2026-11-14', partyName: 'Scrap Seller', partyId, lot: 'LOT-1',
    lines: [], totalKg: 10, total: 1000, cash: 400, bank: 0, mobile: 0, mobileType: 'bKash' as const,
    ref: '', paid: 400, due: 600, notes: '', preparedBy: 'Admin', createdAt: new Date().toISOString(),
    ...overrides
  });

  const bookOf = (data: DataService, partyId: number, side: 'sales' | 'purchase') =>
    accountOf(data.parties().find(p => p.id === partyId)!, side);

  it('posts total/paid/due to the purchase book, follows an edit and reverses on delete', () => {
    const { data } = setup();
    const seller = data.addParty(party({ name: 'Scrap Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    const created = data.addBatteryVoucher(payload(seller.id));
    expect(bookOf(data, seller.id, 'purchase')).toMatchObject({ total: 1000, paid: 400, due: 600 });

    data.updateBatteryVoucher(created.id, payload(seller.id, { cash: 1000, paid: 1000, due: 0 }));
    expect(bookOf(data, seller.id, 'purchase')).toMatchObject({ total: 1000, paid: 1000, due: 0 });

    data.deleteBatteryVoucher(created.id);
    expect(bookOf(data, seller.id, 'purchase')).toMatchObject({ total: 0, paid: 0, due: 0 });
  });

  it('leaves the party books alone for a sale trade-in voucher settled on the invoice', () => {
    const { data } = setup();
    const customer = data.addParty(party({ name: 'Trade Customer' }) as unknown as Omit<Party, 'id'>);
    data.addBatteryVoucher(payload(customer.id, { cash: 0, paid: 1000, due: 0, source: 'sale-adjustment' }));
    expect(bookOf(data, customer.id, 'sales')).toMatchObject({ total: 0, paid: 0, due: 0 });
  });

  it('puts the wallet and party postings back when a deleted voucher is restored', () => {
    const { data } = setup();
    const seller = data.addParty(party({ name: 'Scrap Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    const created = data.addBatteryVoucher(payload(seller.id));
    expect(data.walletTransactions()).toHaveLength(1);

    data.deleteBatteryVoucher(created.id);
    expect(data.walletTransactions()).toHaveLength(0);
    expect(bookOf(data, seller.id, 'purchase')).toMatchObject({ total: 0, paid: 0, due: 0 });

    const entry = data.recycleBin().find(e => e.collection === 'sm_battery_vouchers_v1')!;
    expect(data.restoreRecycle(entry.id)).toBe('restored');
    expect(data.walletTransactions()).toHaveLength(1);
    expect(bookOf(data, seller.id, 'purchase')).toMatchObject({ total: 1000, paid: 400, due: 600 });
  });
});

describe('Battery stock fund', () => {
  afterEach(() => TestBed.resetTestingModule());

  const payload = (partyId: number, overrides: Partial<Omit<BatteryVoucher, 'id' | 'voucherNo'>> = {}) => ({
    type: 'purchase' as const, date: '2026-11-10', partyName: 'Scrap Seller', partyId, lot: 'LOT-1',
    lines: [], totalKg: 10, total: 1000, cash: 0, bank: 0, mobile: 0, mobileType: 'bKash' as const,
    ref: '', paid: 400, due: 600, notes: '', preparedBy: 'Admin', createdAt: '2026-11-10T09:00:00.000Z',
    ...overrides
  });

  const bookOf = (data: DataService, partyId: number) =>
    accountOf(data.parties().find(p => p.id === partyId)!, 'purchase');

  it('measures each party fund from unpaid purchase dues only', () => {
    const { data } = setup();
    const seller = data.addParty(party({ name: 'Scrap Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    const other = data.addParty(party({ name: 'Other Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    const customer = data.addParty(party({ name: 'Trade Customer' }));
    data.addBatteryVoucher(payload(seller.id, { date: '2026-11-10' }));
    data.addBatteryVoucher(payload(seller.id, { date: '2026-11-12', total: 500, paid: 200, due: 300 }));
    data.addBatteryVoucher(payload(other.id, { date: '2026-11-11', total: 100, paid: 0, due: 100 }));
    data.addBatteryVoucher(payload(customer.id, { paid: 1000, due: 0, source: 'sale-adjustment' }));

    expect(data.batteryFundOfParty(seller.id)).toBe(900);
    expect(data.batteryFundOfParty(other.id)).toBe(100);
    expect(data.batteryFundOfParty(customer.id)).toBe(0);
    expect(data.batteryFundAvailable()).toBe(1000);
  });

  it('settles the oldest due first and posts a supplier receipt plus a wallet Out', () => {
    const { data } = setup();
    const seller = data.addParty(party({ name: 'Scrap Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    const first = data.addBatteryVoucher(payload(seller.id, { date: '2026-11-10' }));
    const second = data.addBatteryVoucher(payload(seller.id, { date: '2026-11-12', total: 400, paid: 0, due: 400 }));

    const result = data.transferBatteryFund({ partyId: seller.id, amount: 700, mode: 'Cash', date: '2026-11-15', note: 'Fund payout' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transfer.transferNo).toBe('BFT-1001');
    expect(result.transfer.allocations).toEqual([
      { voucherId: first.id, voucherNo: first.voucherNo, amount: 600 },
      { voucherId: second.id, voucherNo: second.voucherNo, amount: 100 }
    ]);

    expect(bookOf(data, seller.id)).toMatchObject({ total: 1400, paid: 1100, due: 300 });
    const receipt = data.payments().find(p => p.id === result.transfer.paymentId)!;
    expect(receipt).toMatchObject({ partyType: 'Supplier', amount: 700, batteryFundTransferId: result.transfer.id });
    const rows = data.walletTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'Out', amount: 700, source: 'Battery', refId: result.transfer.id });
    expect(data.walletBalance(rows[0].accountId)).toBe(-700);
    expect(data.batteryFundOfParty(seller.id)).toBe(300);
    expect(data.batteryFundAllocatedFor(first.id)).toBe(600);
  });

  it('refuses more than the party fund and writes nothing', () => {
    const { data } = setup();
    const seller = data.addParty(party({ name: 'Scrap Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    data.addBatteryVoucher(payload(seller.id));

    const result = data.transferBatteryFund({ partyId: seller.id, amount: 600.02, mode: 'Cash', date: '2026-11-15', note: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('600.00');
    expect(data.payments()).toHaveLength(0);
    expect(data.walletTransactions()).toHaveLength(0);
    expect(data.batteryFundTransfers()).toHaveLength(0);
    expect(bookOf(data, seller.id)).toMatchObject({ total: 1000, paid: 400, due: 600 });
  });

  it('locks the receipt and the settled voucher until the transfer is reversed', () => {
    const { data } = setup();
    const seller = data.addParty(party({ name: 'Scrap Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    const voucher = data.addBatteryVoucher(payload(seller.id));

    const result = data.transferBatteryFund({ partyId: seller.id, amount: 600, mode: 'Cash', date: '2026-11-15', note: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const transfer = result.transfer;

    expect(data.updatePayment(transfer.paymentId!, { amount: 100 })).toBeNull();
    data.deletePayment(transfer.paymentId!);
    expect(data.payments()).toHaveLength(1);
    expect(bookOf(data, seller.id)).toMatchObject({ total: 1000, paid: 1000, due: 0 });

    data.updateBatteryVoucher(voucher.id, payload(seller.id, { total: 900, paid: 400, due: 500 }));
    expect(data.batteryVouchers()[0]).toMatchObject({ total: 1000, due: 600 });
    data.deleteBatteryVoucher(voucher.id);
    expect(data.batteryVouchers()).toHaveLength(1);

    data.deleteBatteryFundTransfer(transfer.id);
    expect(data.payments()).toHaveLength(0);
    expect(data.walletTransactions()).toHaveLength(0);
    expect(bookOf(data, seller.id)).toMatchObject({ total: 1000, paid: 400, due: 600 });
    expect(data.batteryFundTransfers()).toHaveLength(0);
    expect(data.batteryFundOfParty(seller.id)).toBe(600);
    expect(data.recycleBin().some(e => e.collection === 'sm_battery_fund_transfers_v1')).toBe(true);
  });

  it('books the excess as advance when the supplier book already owes less', () => {
    const { data } = setup();
    const seller = data.addParty(party({ name: 'Scrap Seller', type: 'Supplier' }) as unknown as Omit<Party, 'id'>);
    data.addBatteryVoucher(payload(seller.id));
    data.recordPayment({
      partyId: seller.id, partyName: seller.name, partyType: 'Supplier', side: 'purchase',
      amount: 200, discount: 0, mode: 'Cash', date: '2026-11-14', note: 'Manual part payment'
    });
    expect(bookOf(data, seller.id)).toMatchObject({ total: 1000, paid: 600, due: 400 });

    const result = data.transferBatteryFund({ partyId: seller.id, amount: 600, mode: 'Cash', date: '2026-11-15', note: '' });
    expect(result.ok).toBe(true);
    expect(bookOf(data, seller.id)).toMatchObject({ total: 1000, paid: 1200, due: 0, advance: 200 });
    expect(data.walletTransactions().filter(r => r.direction === 'Out')).toHaveLength(1);
  });
});

describe('Battery sale profit', () => {
  afterEach(() => TestBed.resetTestingModule());

  const batteryPayload = (overrides: Partial<Omit<BatteryVoucher, 'id' | 'voucherNo'>>) => ({
    type: 'purchase' as const, date: '2026-11-14', partyName: 'Scrap Seller', lot: 'LOT-1',
    lines: [], totalKg: 0, total: 0, cash: 0, bank: 0, mobile: 0, mobileType: 'bKash' as const,
    ref: '', paid: 0, due: 0, notes: '', preparedBy: 'Admin', createdAt: new Date().toISOString(),
    ...overrides
  });

  const stockOf = (data: DataService) => data.addBatteryVoucher(batteryPayload({
    lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 10, rate: 200 }],
    totalKg: 10, total: 2000
  }));

  it('values a sale with no entered lot cost at the purchase lots it consumes', () => {
    const { data } = setup();
    stockOf(data);
    const saleVoucher = data.addBatteryVoucher(batteryPayload({
      type: 'sale',
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 5, rate: 300 }],
      totalKg: 5, total: 1500, cost: 0
    }));
    expect(data.batteryVoucherCost(saleVoucher)).toBe(1000);
    expect(data.batteryVoucherProfit(saleVoucher)).toBe(500);
    expect(data.batterySummary()).toMatchObject({ saleTotal: 1500, saleCost: 1000, profit: 500, incompleteSales: 0 });
    // The five kilograms left in stock still carry their purchase value.
    expect(data.batteryKindStock()).toContainEqual(expect.objectContaining({ key: 'scrap', qty: 5, value: 1000, avgRate: 200 }));
  });

  it('consumes the oldest purchase lot first across several lots', () => {
    const { data } = setup();
    data.addBatteryVoucher(batteryPayload({
      date: '2026-11-10',
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 10, rate: 200 }],
      totalKg: 10, total: 2000
    }));
    data.addBatteryVoucher(batteryPayload({
      date: '2026-11-12',
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 10, rate: 250 }],
      totalKg: 10, total: 2500
    }));
    const saleVoucher = data.addBatteryVoucher(batteryPayload({
      type: 'sale', date: '2026-11-14',
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 15, rate: 300 }],
      totalKg: 15, total: 4500
    }));
    // 10 × 200 + 5 × 250 = 3250 against 4500 of revenue.
    expect(data.batteryVoucherCost(saleVoucher)).toBe(3250);
    expect(data.batteryVoucherProfit(saleVoucher)).toBe(1250);
    // Only the dearer lot is left, valued at its own rate.
    expect(data.batteryKindStock()).toContainEqual(expect.objectContaining({ key: 'scrap', qty: 5, value: 1250, avgRate: 250 }));
  });

  it('shows an incomplete purchase cost instead of counting the whole sale as profit', () => {
    const { data } = setup();
    const saleVoucher = data.addBatteryVoucher(batteryPayload({
      type: 'sale',
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 5, rate: 300 }],
      totalKg: 5, total: 1500, cost: 0
    }));
    expect(data.batteryVoucherCostIncomplete(saleVoucher)).toBe(true);
    expect(data.batteryVoucherProfit(saleVoucher)).toBe(0);
    expect(data.batterySummary()).toMatchObject({ saleTotal: 1500, saleCost: 0, profit: 0, incompleteSales: 1 });
  });

  it('treats a partly costed sale as incomplete instead of costing only the covered kinds', () => {
    const { data } = setup();
    stockOf(data); // 10 kg scrap bought, nothing else
    const lines = [
      { kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg' as const, kg: 3, rate: 300 },
      { kind: 'Water / UPS', kindKey: 'water', unit: 'kg' as const, kg: 2, rate: 400 }
    ];
    expect(data.batteryLinesCost(lines)).toBe(600);
    expect(data.batteryLinesCostIncomplete(lines)).toBe(true);

    const saleVoucher = data.addBatteryVoucher(batteryPayload({
      type: 'sale', lines, totalKg: 5, total: 1700, cost: 0
    }));
    expect(data.batteryVoucherCostIncomplete(saleVoucher)).toBe(true);
    expect(data.batteryVoucherProfit(saleVoucher)).toBe(0);
  });

  it('flags a line that is longer than the remaining lots of its own kind', () => {
    const { data } = setup();
    data.addBatteryVoucher(batteryPayload({
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 4, rate: 200 }],
      totalKg: 4, total: 800
    }));
    const lines = [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg' as const, kg: 10, rate: 300 }];
    expect(data.batteryLinesCost(lines)).toBe(800);
    expect(data.batteryLinesCostIncomplete(lines)).toBe(true);
  });

  it('stops showing incomplete once a lot cost is set on the sale', () => {
    const { data } = setup();
    const saleVoucher = data.addBatteryVoucher(batteryPayload({
      type: 'sale',
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 5, rate: 300 }],
      totalKg: 5, total: 1500, cost: 0
    }));
    data.setBatteryVoucherCost(saleVoucher.id, 1200);
    const fixed = data.batteryVouchers().find(v => v.id === saleVoucher.id)!;
    expect(data.batteryVoucherCostIncomplete(fixed)).toBe(false);
    expect(data.batteryVoucherProfit(fixed)).toBe(300);
    expect(data.batterySummary()).toMatchObject({ saleCost: 1200, profit: 300, incompleteSales: 0 });
  });

  it('keeps a typed lot cost as the cost basis', () => {
    const { data } = setup();
    stockOf(data);
    const saleVoucher = data.addBatteryVoucher(batteryPayload({
      type: 'sale',
      lines: [{ kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 5, rate: 300 }],
      totalKg: 5, total: 1500, cost: 900
    }));
    expect(data.batteryVoucherProfit(saleVoucher)).toBe(600);
  });

  it('costs each sold kind from its own purchase lots', () => {
    const { data } = setup();
    data.addBatteryVoucher(batteryPayload({
      lines: [
        { kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 10, rate: 200 },
        { kind: 'UPS / MC', kindKey: 'ups', unit: 'kg', kg: 4, rate: 500 }
      ],
      totalKg: 14, total: 4000
    }));
    const saleVoucher = data.addBatteryVoucher(batteryPayload({
      type: 'sale',
      lines: [
        { kind: 'Scrap / Powder', kindKey: 'scrap', unit: 'kg', kg: 2, rate: 260 },
        { kind: 'UPS / MC', kindKey: 'ups', unit: 'kg', kg: 1, rate: 700 }
      ],
      totalKg: 3, total: 1220
    }));
    // 2 × 200 + 1 × 500 = 900 cost, so the margin is 320.
    expect(data.batteryVoucherProfit(saleVoucher)).toBe(320);
  });
});

describe('Cash closing by date', () => {
  afterEach(() => TestBed.resetTestingModule());

  const closing = (date: string, countedCash: number) => ({
    date, openingCash: 1000, cashSales: 500, bankSales: 0, collections: 0, expenses: 0,
    expectedCash: 1500, countedCash, difference: countedCash - 1500,
    note: '', closedBy: 'Admin'
  });

  it('keeps one closing per day and updates it on a second save', () => {
    const { data } = setup();
    const first = data.saveCashClosing(closing('2026-11-12', 1490));
    const second = data.saveCashClosing(closing('2026-11-12', 1520));
    expect(data.cashClosings()).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(data.cashClosings()[0].countedCash).toBe(1520);
  });

  it('stores closings saved for two different custom dates side by side', () => {
    const { data } = setup();
    data.saveCashClosing(closing('2026-11-10', 1500));
    data.saveCashClosing(closing('2026-11-12', 1500));
    expect(data.cashClosings().map(c => c.date).sort()).toEqual(['2026-11-10', '2026-11-12']);
  });
});

describe('DataService stock reconciliation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sets an exact counted quantity, keeps purchase and sale records untouched and persists the audit row', () => {
    const { data, writes } = setup();
    data.products.set([product({ stock: 5 })]);
    const result = data.adjustProductStock(10, { quantity: 8 }, { reason: 'found', note: '  extra 3 pieces  ', user: 'Admin' });
    expect(result.ok).toBe(true);
    expect(data.products()[0].stock).toBe(8);
    const adjustment = data.stockAdjustments()[0];
    expect(adjustment).toMatchObject({
      productId: 10, productName: 'Battery', code: 'B10', unit: 'pcs',
      previousStock: 5, newStock: 8, delta: 3, reason: 'found', note: 'extra 3 pieces', user: 'Admin', variants: []
    });
    expect(writes.get('sm_stock_adjustments_v1')).toEqual([adjustment]);
    expect(data.purchases()).toHaveLength(0);
    expect(data.sales()).toHaveLength(0);
  });

  it('applies counted variant quantities and moves the parent stock by the summed delta', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', stock: 5, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 },
      { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 3 }
    ] })]);
    const result = data.adjustProductStock(10, { variants: { 1: 4 } }, { reason: 'count' });
    expect(result.ok).toBe(true);
    expect(data.products()[0].stock).toBe(7);
    expect(data.products()[0].variants!.map(v => v.openingStock)).toEqual([4, 3]);
    expect(data.stockAdjustments()[0].variants).toEqual([
      { variantId: 1, variantValue: 'A', previous: 2, next: 4 }
    ]);
  });

  it('rejects invalid counts, service products, unknown reasons and no-op adjustments', () => {
    const { data } = setup();
    data.products.set([product({ id: 10, stock: 5 }), product({ id: 11, type: 'service', stock: 0 })]);
    expect(data.adjustProductStock(99, { quantity: 1 }, { reason: 'found' })).toEqual({ ok: false, error: 'missing' });
    expect(data.adjustProductStock(11, { quantity: 1 }, { reason: 'found' })).toEqual({ ok: false, error: 'service' });
    expect(data.adjustProductStock(10, { quantity: 2 }, { reason: 'bogus' as never })).toEqual({ ok: false, error: 'reason' });
    expect(data.adjustProductStock(10, { quantity: -1 }, { reason: 'found' })).toEqual({ ok: false, error: 'quantity' });
    expect(data.adjustProductStock(10, { quantity: Number.NaN }, { reason: 'found' })).toEqual({ ok: false, error: 'quantity' });
    expect(data.adjustProductStock(10, { quantity: 5 }, { reason: 'found' })).toEqual({ ok: false, error: 'nochange' });
    expect(data.products()[0].stock).toBe(5);
    expect(data.stockAdjustments()).toHaveLength(0);
  });

  it('refuses to leave the parent stock negative when variants are corrected downwards', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', stock: 2, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 4 }
    ] })]);
    expect(data.adjustProductStock(10, { variants: { 1: 0 } }, { reason: 'damage' })).toEqual({ ok: false, error: 'negative' });
    expect(data.products()[0].stock).toBe(2);
    expect(data.products()[0].variants![0].openingStock).toBe(4);
  });
});

describe('DataService warranty stock corrections', () => {
  afterEach(() => TestBed.resetTestingModule());

  function seed() {
    const { data } = setup();
    data.warrantyStockMovements.set([
      { id: 1, date: '2026-11-10', pool: 'received', quantity: 5, productId: 10, productName: 'Battery', serialNumber: 'S1', unit: 'pcs', reason: 'receipt', refNo: 'C1', createdAt: '2026-11-10T00:00:00.000Z' },
      { id: 2, date: '2026-11-11', pool: 'received', quantity: 2, productId: 10, productName: 'Battery', serialNumber: '', unit: 'pcs', reason: 'receipt', refNo: 'C2', createdAt: '2026-11-11T00:00:00.000Z' },
      { id: 3, date: '2026-11-11', pool: 'received', quantity: -5, productId: 10, productName: 'Battery', serialNumber: '', unit: 'pcs', reason: 'disposal', refNo: 'C1', createdAt: '2026-11-11T00:00:00.000Z' }
    ]);
    return data;
  }

  it('edits a signed movement and recalculates the pool balance', () => {
    const data = seed();
    expect(data.warrantyStockOf(10, 'Battery', 'pcs').received).toBe(2);
    const result = data.updateWarrantyStockMovement(2, {
      pool: 'received', quantity: 3, date: '2026-11-11', serialNumber: '', refNo: 'C2', note: 'corrected'
    });
    expect(result.ok).toBe(true);
    expect(data.warrantyStockOf(10, 'Battery', 'pcs').received).toBe(3);
    const row = data.warrantyStockMovements().find(movement => movement.id === 2)!;
    expect(row.quantity).toBe(3);
    expect(row.note).toBe('corrected');
  });

  it('moves a movement between pools only when neither pool turns negative', () => {
    const data = seed();
    expect(data.updateWarrantyStockMovement(3, {
      pool: 'replacement', quantity: -5, date: '2026-11-11', serialNumber: '', refNo: 'C1'
    })).toEqual({ ok: false, error: 'shortage' });
    expect(data.updateWarrantyStockMovement(3, {
      pool: 'replacement', quantity: 5, date: '2026-11-11', serialNumber: '', refNo: 'C1'
    }).ok).toBe(true);
    expect(data.warrantyStockOf(10, 'Battery', 'pcs')).toEqual({ received: 7, replacement: 5 });
  });

  it('rejects an edit that would make the balance negative', () => {
    const data = seed();
    const result = data.updateWarrantyStockMovement(1, {
      pool: 'received', quantity: 1, date: '2026-11-10', serialNumber: 'S1', refNo: 'C1'
    });
    expect(result).toEqual({ ok: false, error: 'shortage' });
    expect(data.warrantyStockMovements().find(movement => movement.id === 1)!.quantity).toBe(5);
  });

  it('deletes a movement and blocks deletions that would leave a negative balance', () => {
    const data = seed();
    expect(data.deleteWarrantyStockMovement(1)).toEqual({ ok: false, error: 'shortage' });
    expect(data.deleteWarrantyStockMovement(3).ok).toBe(true);
    expect(data.warrantyStockOf(10, 'Battery', 'pcs').received).toBe(7);
    expect(data.warrantyStockMovements()).toHaveLength(2);
  });

  it('reports a missing movement instead of silently succeeding', () => {
    const data = seed();
    expect(data.updateWarrantyStockMovement(99, {
      pool: 'received', quantity: 1, date: '2026-11-11'
    })).toEqual({ ok: false, error: 'missing' });
    expect(data.deleteWarrantyStockMovement(99)).toEqual({ ok: false, error: 'missing' });
  });
});

describe('DataService warranty claim lifecycle', () => {
  afterEach(() => TestBed.resetTestingModule());

  function seed() {
    const { data } = setup();
    data.products.set([product({ warrantyDays: 180 })]);
    const receipt = data.recordWarrantyReceipt({
      date: '2026-11-18', customerName: 'Customer', phone: '01700000000', invoiceNumber: '',
      productId: 10, productName: 'Battery', serialNumber: 'SN-OLD-1', quantity: 1, unit: 'pcs',
      condition: 'Dead', reason: 'Dead', status: 'গ্রহণ করা হয়েছে', stockIn: true
    });
    return { data, receipt };
  }

  function replace(data: DataService, receiptId: number, overrides: Record<string, unknown> = {}) {
    return data.recordWarrantyReplacement({
      date: '2026-11-18', receiptId, customerName: 'Customer', phone: '01700000000', productId: 10,
      productName: 'Battery', serialNumber: 'SN-NEW-1', quantity: 1, unit: 'pcs', source: 'warranty',
      stockInQty: 1, disposeReceived: true, disposition: 'Scrap', cost: 0, stage: 'completed', status: 'সম্পন্ন',
      ...overrides
    } as Parameters<DataService['recordWarrantyReplacement']>[0]);
  }

  it('settles the receipt on a completed replacement and reopens it when cancelled', () => {
    const { data, receipt } = seed();
    const voucher = replace(data, receipt.id).record!;
    const settled = data.warrantyReceipts().find(r => r.id === receipt.id)!;
    expect(settled.replacementClaimNo).toBe(voucher.claimNo);
    expect(settled.status).toBe('পরিবর্তন সম্পন্ন');
    expect(data.warrantyStockOf(10, 'Battery', 'pcs')).toEqual({ received: 0, replacement: 0 });

    expect(data.updateWarrantyReplacement(voucher.id, { stage: 'cancelled' }).ok).toBe(true);
    const reopened = data.warrantyReceipts().find(r => r.id === receipt.id)!;
    expect(reopened.replacementClaimNo).toBeUndefined();
    expect(reopened.status).toBe('গ্রহণ করা হয়েছে');
    expect(data.warrantyStockOf(10, 'Battery', 'pcs')).toEqual({ received: 1, replacement: 0 });
  });

  it('locks the stock fields and status label of a settled receipt', () => {
    const { data, receipt } = seed();
    replace(data, receipt.id);
    expect(data.updateWarrantyReceipt(receipt.id, { quantity: 2 })).toEqual({ ok: false, error: 'settled' });
    expect(data.updateWarrantyReceipt(receipt.id, { status: 'বাতিল' })).toEqual({ ok: false, error: 'settled' });
    expect(data.updateWarrantyReceipt(receipt.id, { notes: 'customer called' }).ok).toBe(true);
  });

  it('lets a cancelled voucher stop blocking the receipt deletion', () => {
    const { data, receipt } = seed();
    const voucher = replace(data, receipt.id).record!;
    expect(data.deleteWarrantyReceipt(receipt.id)).toEqual({ ok: false, error: 'replaced' });
    expect(data.updateWarrantyReplacement(voucher.id, { stage: 'cancelled' }).ok).toBe(true);
    expect(data.deleteWarrantyReceipt(receipt.id)).toEqual({ ok: true });
    expect(data.warrantyStockOf(10, 'Battery', 'pcs')).toEqual({ received: 0, replacement: 0 });
  });

  it('keeps claim-linked ledger rows editable for notes only and undeleatable', () => {
    const { data } = seed();
    const movement = data.warrantyStockMovements().find(row => row.reason === 'receipt')!;
    expect(movement.claimId).not.toBeUndefined();
    expect(data.updateWarrantyStockMovement(movement.id, {
      pool: 'received', quantity: 3, date: movement.date, serialNumber: movement.serialNumber, refNo: movement.refNo
    })).toEqual({ ok: false, error: 'claimed' });
    expect(data.updateWarrantyStockMovement(movement.id, {
      pool: movement.pool, quantity: movement.quantity, date: movement.date, serialNumber: movement.serialNumber,
      refNo: movement.refNo, note: 'corrected note'
    }).ok).toBe(true);
    expect(data.deleteWarrantyStockMovement(movement.id)).toEqual({ ok: false, error: 'claimed' });
    expect(data.warrantyStockOf(10, 'Battery', 'pcs').received).toBe(1);
  });

  it('shows the receipt’s own warranty period in the register expiry column', () => {
    const { data } = setup();
    data.products.set([product()]);
    const receipt = data.recordWarrantyReceipt({
      date: '2026-11-01', customerName: 'Customer', phone: '', invoiceNumber: '', productId: 10,
      productName: 'Battery', serialNumber: 'SN-1', quantity: 1, unit: 'pcs', condition: 'Dead', reason: 'Dead',
      status: 'গ্রহণ করা হয়েছে', stockIn: true, warrantyStart: '2026-09-01', warrantyDays: 90
    });
    const rows = buildWarrantyRegister({
      sales: [], purchases: [], products: data.products(), manual: [],
      receipts: data.warrantyReceipts(), replacements: [], todayIso: '2026-11-18'
    });
    const row = rows.find(entry => entry.receiptId === receipt.id)!;
    expect(row.warrantyDays).toBe(90);
    expect(row.expiryDate).toBe('2026-11-30');
    expect(row.remainingDays).toBe(12);
  });

  it('keeps unreceived purchases and cancelled vouchers out of the register', () => {
    const { data, receipt } = seed();
    const voucher = replace(data, receipt.id).record!;
    data.updateWarrantyReplacement(voucher.id, { stage: 'cancelled' });
    for (const status of ['Pending', 'Received'] as const) {
      data.recordPurchase({
        invoice: `PUR-${status}`, warehouse: 'SM Warehouse', date: '2026-11-18', supplierName: 'Supplier',
        preparedBy: 'Admin', status, total: 160, paid: 0, due: 160, paymentStatus: 'Unpaid', nextPayDate: '', notes: '',
        items: [{ id: 1, productId: 10, productName: 'Battery', itemCode: 'B10', unit: 'pcs', quantity: 2, purchasePrice: 80, subtotal: 160 }]
      });
    }
    const rows = buildWarrantyRegister({
      sales: data.sales(), purchases: data.purchases(), products: data.products(), manual: [],
      receipts: data.warrantyReceipts(), replacements: data.warrantyReplacements(), todayIso: '2026-11-18'
    });
    expect(rows.filter(row => row.type === 'Purchase').map(row => row.invoiceNumber)).toEqual(['PUR-Received']);
    const claimRow = rows.find(row => row.receiptId === receipt.id)!;
    expect(claimRow.claim?.newSerial).toBe('');
    expect(claimRow.claim?.status).toBe('গ্রহণ করা হয়েছে');
  });
});

describe('DataService catalogue import', () => {
  afterEach(() => TestBed.resetTestingModule());

  const csvCell = (value: string) => /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const csvRow = (cells: string[]) => cells.map(csvCell).join(',');

  function catalogueFile(): File {
    const header = ['Product Name', 'Item Code / SKU', 'Product Type', 'Category', 'Sub-Category', 'Brand',
      'Product Model', 'Barcode Symbology', 'Unit', 'Purchase Price (BDT)', 'Sales Price (BDT)',
      'Wholesale Price (BDT)', 'Wholesale Min Qty', 'Current Stock', 'Opening Stock', 'Alert Quantity',
      'Rack / Shelf No', 'Warranty Period', 'Image URL'];
    const row = (cells: string[]) => csvRow([...cells, ...Array(header.length - cells.length).fill('')]);
    const lines = [
      'SM ENTERPRISE — OFFICIAL PRODUCT INVENTORY CATALOG',
      'Warehouse: SM Warehouse  |  Total Items: 4',
      '',
      csvRow(header),
      row(['Simple A', '1001', 'Single', 'মোটর ভ্যান', '—', 'Bangla Brand', 'Motor Van', 'CODE128', 'পিস',
        '100', '120', '110', '5', '7', '8', '5', '—', '—', '—']),
      row(['Bearing F & D [Parent Template - 2 Variations]', '2001', 'Variable (Parent)', 'Bearing', '—',
        'F & D', 'All Model', 'CODE128', 'পিস']),
      row(['  ↳ Bearing F & D [Bearing: 6205]', '2002', '  ↳ Variation Item', 'Bearing', '—',
        'F & D', 'All Model', 'CODE128', 'পিস', '74', '90', '85', '', '221', '39', '10']),
      row(['  ↳ Bearing F & D [Bearing: 6003]', '2003', '  ↳ Variation Item', 'Bearing', '—',
        'F & D', 'All Model', 'CODE128', 'পিস', '39', '50', '45', '', '29', '29', '20']),
      csvRow(Array(header.length).fill('TOTAL CONSOLIDATED (4 ITEMS):'))
    ];
    return new File([lines.join('\n')], 'catalog.csv', { type: 'text/csv' });
  }

  it('imports single and variable products, masters and skips the report footer', async () => {
    const { data } = setup();
    const file = catalogueFile();

    const preview = await data.analyzeProductImport(file);
    expect(preview.totalRows).toBe(4);
    expect(preview.added).toBe(2);
    expect(preview.updated).toBe(0);
    expect(preview.variants).toBe(2);
    expect(preview.warnings.join(' ')).toContain('টোটাল');
    expect(data.products()).toHaveLength(0);

    const result = await data.importProducts(file);
    expect(result.added).toBe(2);
    expect(data.products()).toHaveLength(2);
    expect(data.products().some(p => p.name.startsWith('TOTAL'))).toBe(false);

    const simple = data.products().find(p => p.code === '1001')!;
    expect(simple.category).toBe('মোটর ভ্যান');
    expect(simple.subCategory).toBeUndefined();
    expect(simple.rack).toBe('WH-0');
    expect(simple.stock).toBe(7);
    expect(simple.openingStock).toBe(8);
    expect(simple.salesPrice).toBe(120);
    expect(simple.wholesalePrice).toBe(110);
    expect(simple.minQty).toBe(5);

    const parent = data.products().find(p => p.code === '2001')!;
    expect(parent.type).toBe('variant');
    expect(parent.stock).toBe(250);
    expect(parent.variants?.map(v => v.itemCode)).toEqual(['2002', '2003']);
    expect(parent.variants?.map(v => v.variationName)).toEqual(['Bearing', 'Bearing']);
    expect(parent.variants?.map(v => v.variantValue)).toEqual(['6205', '6003']);

    expect(data.categories().map(c => c.name)).toEqual(expect.arrayContaining(['মোটর ভ্যান', 'Bearing']));
    expect(data.subCategories().map(c => c.name)).not.toContain('—');
    expect(data.brands().map(b => b.name)).toEqual(expect.arrayContaining(['Bangla Brand', 'F & D']));
    expect(data.productModels().map(m => m.name)).toEqual(['Motor Van']);
    expect(data.variations()).toHaveLength(1);
    expect(parent.variants?.[0].variationId).toBe(data.variations()[0].id);
    expect(data.variations()[0].values).toContain('6205');

    const again = await data.importProducts(file);
    expect(again.added).toBe(0);
    expect(again.updated).toBe(2);
    expect(data.products()).toHaveLength(2);
  });
});
describe('Staff advance accounting', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('takes the advance from the chosen account and pays recoveries back into it', () => {
    const { data } = setup();
    const account = data.walletAccounts()[0];

    const created = data.addStaffAdvance({
      staffId: 7,
      staffName: 'Md. Rafiq',
      date: '2026-11-11',
      amount: 500,
      recoveredAmount: 0,
      mode: 'Cash',
      accountId: account.id,
      purpose: '',
      status: 'Pending',
      note: ''
    });

    expect(data.walletBalance(account.id)).toBe(-500);
    expect(data.walletTransactions().find(t => t.id === created.walletTxnId)?.source).toBe('StaffAdvance');

    data.updateStaffAdvance(created.id, { amount: 700 });
    expect(data.walletBalance(account.id)).toBe(-700);

    data.recoverStaffAdvance(created.id, 200, { accountId: account.id, date: '2026-11-12', postToWallet: true });
    expect(data.walletBalance(account.id)).toBe(-500);
    expect(data.staffAdvances().find(a => a.id === created.id)?.recoveredAmount).toBe(200);

    // A payroll adjustment only lowers the outstanding balance; no cash enters the account.
    data.recoverStaffAdvance(created.id, 100);
    expect(data.walletBalance(account.id)).toBe(-500);

    data.deleteStaffAdvance(created.id);
    expect(data.walletBalance(account.id)).toBe(0);
    expect(data.walletTransactions()).toHaveLength(0);
  });
});

describe('Salary advance by employee id', () => {
  afterEach(() => TestBed.resetTestingModule());

  const advanceFor = (data: DataService, staffId: number | undefined, staffName: string, amount: number) =>
    data.addStaffAdvance({
      staffId, staffName, date: '2026-11-11', amount, recoveredAmount: 0, mode: 'Cash',
      accountId: data.walletAccounts()[0].id, purpose: '', status: 'Pending', note: ''
    });

  const salaryFor = (data: DataService, staffId: number, advanceAdjusted: number, netPay: number) =>
    data.addSalaryPayment({
      staffId, staffCode: `EMP-${staffId}`, staffName: 'Md. Rafiq', month: '2026-11',
      workingDays: 30, presentDays: 26, lateDays: 0, leaveDays: 4, monthlySalary: 30000,
      perDay: 1000, basicPay: 26000, allowance: 0, deduction: 0, advanceAdjusted,
      netPay, date: '2026-11-30', accountId: data.walletAccounts()[0].id, note: ''
    });

  it('keeps two employees with the same name apart and still finds legacy rows without an id', () => {
    const { data } = setup();
    advanceFor(data, 7, 'Md. Rafiq', 500);
    advanceFor(data, 8, 'Md. Rafiq', 700);
    advanceFor(data, undefined, 'Md. Rafiq', 200);

    expect(data.staffAdvanceOpen(7, 'Md. Rafiq')).toBe(700);
    expect(data.staffAdvanceOpen(8, 'Md. Rafiq')).toBe(900);
    expect(data.staffAdvanceOpen(9, 'Md. Rafiq')).toBe(200);
  });

  it('recovers only the paying employee’s advance and posts no cash row for a fully adjusted salary', () => {
    const { data } = setup();
    const mine = advanceFor(data, 7, 'Md. Rafiq', 500);
    const other = advanceFor(data, 8, 'Md. Rafiq', 700);
    expect(data.walletTransactions()).toHaveLength(2);

    const payment = salaryFor(data, 7, 500, 0);
    expect(payment.walletTxnId).toBeUndefined();
    expect(data.walletTransactions()).toHaveLength(2);
    expect(data.staffAdvances().find(a => a.id === mine.id)?.recoveredAmount).toBe(500);
    expect(data.staffAdvances().find(a => a.id === other.id)?.recoveredAmount).toBe(0);
  });

  it('moves an open advance with the employee when the name is corrected', () => {
    const { data } = setup();
    const created = advanceFor(data, 7, 'Rafiq', 500);
    data.updateStaff(7, { name: 'Md. Rafiq' });

    expect(data.staffAdvances().find(a => a.id === created.id)?.staffName).toBe('Md. Rafiq');
    expect(data.staffAdvanceOpen(7, 'Md. Rafiq')).toBe(500);
  });
});

describe('Party phone identity', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('maps formatting and country-code variants to one subscriber key', () => {
    expect(partyPhoneKey('+880 1712-345678')).toBe('01712345678');
    expect(partyPhoneKey('8801712345678')).toBe('01712345678');
    expect(partyPhoneKey('01712345678')).toBe('01712345678');
    expect(partyPhoneKey('1812-345678')).toBe('1812345678');
    expect(partyPhoneKey('-')).toBe('');
  });

  it('finds the owner of a number and lets that same record edit itself', () => {
    const { data } = setup();
    const created = data.addParty(party({ name: 'Rahim', phone: '+8801712345678' }) as unknown as Omit<Party, 'id'>);
    expect(data.partyByPhone('01712345678')?.id).toBe(created.id);
    expect(data.partyByPhone('01712345678', created.id)).toBeUndefined();
    expect(data.partyByPhone('01999999999')).toBeUndefined();
  });

  it('collects every number of a party, primary first and deduplicated', () => {
    expect(partyPhones(null)).toEqual([]);
    expect(partyPhones({ phone: '-' })).toEqual([]);
    expect(partyPhones({ phone: '01712345678' })).toEqual(['01712345678']);
    expect(partyPhones({ phone: '01712345678', phones: ['+880 1912-345678', '01712345678', ''] }))
      .toEqual(['01712345678', '+880 1912-345678']);
  });

  it('reserves every number a party owns, not only the primary one', () => {
    const { data } = setup();
    const created = data.addParty(party({ name: 'Rahim', phone: '01712345678', phones: ['01912345678'] }) as unknown as Omit<Party, 'id'>);
    expect(data.partyByPhone('01912345678')?.id).toBe(created.id);
    expect(data.partyByPhone('+8801912345678', created.id)).toBeUndefined();
  });
});

describe('Employee leave lifecycle', () => {
  afterEach(() => TestBed.resetTestingModule());

  function employee(data: DataService): HrmStaff {
    return data.addStaff({
      code: 'EMP-01', name: 'Rahim', designation: 'Sales', phone: '', email: '', address: '',
      joinDate: '2026-01-05', monthlySalary: 30000, status: 'Active', note: ''
    });
  }

  function request(data: DataService, staff: HrmStaff, overrides: Partial<HrmLeave> = {}): HrmLeave {
    return data.addLeave({
      staffId: staff.id, staffCode: staff.code, staffName: staff.name,
      fromDate: '2026-03-02', toDate: '2026-03-03', type: 'Casual',
      reason: 'Family', status: 'Approved', note: '', ...overrides
    });
  }

  it('expands a date range inclusively and rejects a reversed range', () => {
    const { data } = setup();
    expect(data.leaveDates('2026-03-02', '2026-03-04')).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    expect(data.leaveDates('2026-03-04', '2026-03-02')).toEqual([]);
    expect(data.leaveDates('', '2026-03-02')).toEqual([]);
    expect(data.leaveDates('2026-03-02', '2026-03-02')).toEqual(['2026-03-02']);
  });

  it('writes paid leave rows into attendance for every day in the range', () => {
    const { data } = setup();
    const staff = employee(data);
    const leave = request(data, staff);
    const rows = data.attendance().filter(a => a.leaveId === leave.id);
    expect(rows.map(r => r.date).sort()).toEqual(['2026-03-02', '2026-03-03']);
    expect(rows.every(r => r.status === 'Leave' && !r.timeIn && !r.timeOut)).toBe(true);
    expect(data.hrmLeaves()).toHaveLength(1);
  });

  it('writes unpaid leave as absent so payroll does not pay those days', () => {
    const { data } = setup();
    const staff = employee(data);
    const leave = request(data, staff, { type: 'Unpaid', fromDate: '2026-03-02', toDate: '2026-03-02' });
    const row = data.attendance().find(a => a.leaveId === leave.id);
    expect(row?.status).toBe('Absent');
    expect(data.unpaidLeaveInMonth(staff.id, '2026-03')).toBe(1);
  });

  it('never overwrites a day that already has a real punch', () => {
    const { data } = setup();
    const staff = employee(data);
    data.addAttendance({
      staffId: staff.id, staffCode: staff.code, staffName: staff.name, date: '2026-03-02',
      timeIn: '09:10', timeOut: '18:00', method: 'QR', status: 'Present', note: ''
    });
    const leave = request(data, staff);
    const punched = data.attendance().find(a => a.staffId === staff.id && a.date === '2026-03-02');
    expect(punched?.status).toBe('Present');
    expect(punched?.leaveId).toBeUndefined();
    expect(data.attendance().filter(a => a.leaveId === leave.id).map(a => a.date)).toEqual(['2026-03-03']);
  });

  it('cancelling a leave removes its placeholder days but keeps worked days', () => {
    const { data } = setup();
    const staff = employee(data);
    const leave = request(data, staff);
    // The employee shows up on the second day.
    const second = data.attendance().find(a => a.leaveId === leave.id && a.date === '2026-03-03')!;
    data.updateAttendance(second.id, { timeIn: '09:00', timeOut: '18:00', status: 'Present' });
    data.updateLeave(leave.id, { status: 'Cancelled' });

    expect(data.attendance().filter(a => a.leaveId === leave.id)).toHaveLength(0);
    const kept = data.attendance().find(a => a.id === second.id);
    expect(kept?.status).toBe('Present');
    expect(data.attendance().some(a => a.date === '2026-03-02')).toBe(false);
  });

  it('detects overlapping pending or approved requests and ignores the edited row', () => {
    const { data } = setup();
    const staff = employee(data);
    const leave = request(data, staff, { fromDate: '2026-03-02', toDate: '2026-03-05' });
    expect(data.overlappingLeave(staff.id, '2026-03-04', '2026-03-08')?.id).toBe(leave.id);
    expect(data.overlappingLeave(staff.id, '2026-03-04', '2026-03-08', leave.id)).toBeUndefined();
    expect(data.overlappingLeave(staff.id, '2026-04-01', '2026-04-02')).toBeUndefined();
    data.updateLeave(leave.id, { status: 'Rejected' });
    expect(data.overlappingLeave(staff.id, '2026-03-04', '2026-03-06')).toBeUndefined();
  });

  it('marks the employee on leave today and restores active status on cancel', () => {
    const { data } = setup();
    const staff = employee(data);
    const today = localDateIso();
    const [y, m, d] = today.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const leave = request(data, staff, { fromDate: today, toDate: tomorrow });
    expect(data.hrmStaff().find(s => s.id === staff.id)?.status).toBe('On Leave');
    data.updateLeave(leave.id, { status: 'Cancelled' });
    expect(data.hrmStaff().find(s => s.id === staff.id)?.status).toBe('Active');
  });

  it('removes the employee attendance and leave rows when the employee is deleted', () => {
    const { data } = setup();
    const staff = employee(data);
    request(data, staff);
    data.deleteStaff(staff.id);
    expect(data.attendance().filter(a => a.staffId === staff.id)).toHaveLength(0);
    expect(data.hrmLeaves().filter(l => l.staffId === staff.id)).toHaveLength(0);
    expect(data.hrmStaff().some(s => s.id === staff.id)).toBe(false);
  });
});


describe('Multi-unit sales', () => {
  afterEach(() => TestBed.resetTestingModule());

  function rice(overrides: Partial<Product> = {}): Product {
    return product({
      name: 'Rice', code: 'R1', unit: 'গ্রাম', stock: 5000, salesPrice: 0.16, purchasePrice: 0.12,
      wholesalePrice: 0.15,
      units: [{ name: 'কেজি', factor: 1000, price: 160 }],
      ...overrides
    });
  }

  it('deducts stock in base units when the line is sold in an extra unit', () => {
    const { data } = setup();
    data.products.set([rice()]);
    data.parties.set([party()]);
    sale(data, {
      total: 320,
      items: [{ id: 1, productId: 10, productName: 'Rice', quantity: 2, unit: 'কেজি', unitFactor: 1000, salesPrice: 160, total: 320 }]
    });
    expect(data.products()[0].stock).toBe(3000);
    expect(accountOf(data.parties()[0], 'sales').total).toBe(320);
  });

  it('rejects an extra-unit line that exceeds the base-unit stock', () => {
    const { data } = setup();
    data.products.set([rice({ stock: 1500 })]);
    expect(() => sale(data, {
      total: 320,
      items: [{ id: 1, productId: 10, productName: 'Rice', quantity: 2, unit: 'কেজি', unitFactor: 1000, salesPrice: 160, total: 320 }]
    })).toThrow('Insufficient stock');
    expect(data.products()[0].stock).toBe(1500);
    expect(data.sales()).toHaveLength(0);
  });

  it('restores base units for a restocked return of an extra-unit line', () => {
    const { data } = setup();
    data.products.set([rice()]);
    data.parties.set([party()]);
    sale(data, {
      total: 320,
      items: [{ id: 1, productId: 10, productName: 'Rice', quantity: 2, unit: 'কেজি', unitFactor: 1000, salesPrice: 160, total: 320 }]
    });
    expect(data.products()[0].stock).toBe(3000);
    credit(data, {
      restock: true,
      amount: 160,
      items: [{ productId: 10, productName: 'Rice', quantity: 1, unit: 'কেজি', unitFactor: 1000, unitPrice: 160, total: 160 }]
    });
    expect(data.products()[0].stock).toBe(4000);
  });

  it('puts the full base quantity back when a multi-unit sale is cancelled', () => {
    const { data } = setup();
    data.products.set([rice()]);
    data.parties.set([party()]);
    const saved = sale(data, {
      total: 320,
      items: [{ id: 1, productId: 10, productName: 'Rice', quantity: 2, unit: 'কেজি', unitFactor: 1000, salesPrice: 160, total: 320 }]
    });
    data.updateSaleStatus(saved.id, 'Cancelled');
    expect(data.products()[0].stock).toBe(5000);
  });
});

describe('Sale cancellation battery trade-in', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('drops the linked trade-in voucher on cancel and rebuilds it on reactivation', () => {
    const { data } = setup();
    data.products.set([product()]);
    data.parties.set([party()]);
    const saved = sale(data, {
      batteryAdjustments: [{ id: 1, description: 'Old battery', weightKg: 10, ratePerKg: 20, total: 200 }],
      batteryAdjustmentTotal: 200
    });
    expect(data.batteryVouchers()).toHaveLength(1);
    const linkedId = data.sales().find(s => s.id === saved.id)!.batteryVoucherId;
    expect(linkedId).toBe(data.batteryVouchers()[0].id);

    data.updateSaleStatus(saved.id, 'Cancelled');
    expect(data.batteryVouchers()).toHaveLength(0);

    data.updateSaleStatus(saved.id, 'Completed');
    expect(data.batteryVouchers()).toHaveLength(1);
    expect(data.sales().find(s => s.id === saved.id)!.batteryVoucherId).toBe(data.batteryVouchers()[0].id);
  });
});

describe('Damage stock by variant', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('moves the selected variant and parent stock, and restores both on delete', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', stock: 5, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 },
      { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 3 }
    ] })]);
    const record = data.addDamageRecord({
      date: '2026-11-18', productName: 'Battery - A', variantId: 1, quantity: 2,
      unitCost: 80, lossAmount: 160, warehouse: 'SM Warehouse', reason: 'Broken',
      action: 'Scrapped', status: 'Approved', stockDeducted: false, note: ''
    });
    expect(data.products()[0].stock).toBe(3);
    expect(data.products()[0].variants!.map(v => v.openingStock)).toEqual([0, 3]);

    data.deleteDamageRecord(record.id);
    expect(data.products()[0].stock).toBe(5);
    expect(data.products()[0].variants!.map(v => v.openingStock)).toEqual([2, 3]);
  });

  it('matches legacy variant labels saved without a variant id', () => {
    const { data } = setup();
    data.products.set([product({ type: 'variant', stock: 5, variants: [
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 }
    ] })]);
    data.addDamageRecord({
      date: '2026-11-18', productName: 'Battery - A', quantity: 1,
      unitCost: 80, lossAmount: 80, warehouse: 'SM Warehouse', reason: 'Broken',
      action: 'Scrapped', status: 'Approved', stockDeducted: false, note: ''
    });
    expect(data.products()[0].stock).toBe(4);
    expect(data.products()[0].variants![0].openingStock).toBe(1);
  });
});

describe('Walk-in customer books', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('clears a stray due or advance saved under the walk-in label', () => {
    const { data } = setup();
    const walkIn = party({
      name: 'Walk In Customer',
      total: -200, due: -200, advance: 200,
      salesTotal: 300, salesPaid: 500, salesDue: -200, salesAdvance: 200
    });
    data.parties.set([walkIn]);
    data.updateParty({ ...walkIn });
    const saved = data.parties()[0];
    expect(saved.salesDue).toBe(0);
    expect(saved.salesAdvance).toBe(0);
    expect(saved.due).toBe(0);
    expect(saved.advance).toBe(0);
  });

  it('recognizes the Bengali walk-in label too', () => {
    const { data } = setup();
    const walkIn = party({ name: 'ওয়াক-ইন কাস্টমার', salesDue: -200, due: -200 });
    data.parties.set([walkIn]);
    data.updateParty({ ...walkIn });
    expect(data.parties()[0].due).toBe(0);
  });

  it('never posts a sale to a party that carries the walk-in label', () => {
    const { data } = setup();
    data.products.set([product()]);
    data.parties.set([party({ name: 'Walk In Customer' })]);
    sale(data, { customerName: 'Walk In Customer', partyId: 1, total: 100, paid: 100, due: 0 });
    expect(accountOf(data.parties()[0], 'sales')).toEqual({ total: 0, paid: 0, due: 0, advance: 0 });
  });

  it('keeps a walk-in bill at zero due when a credit note exceeds the bill', () => {
    const { data } = setup();
    data.products.set([product()]);
    sale(data, { customerName: 'Walk In Customer', total: 100, paid: 100, due: 0 });
    credit(data, { customerName: 'Walk In Customer', invoiceNumber: 'Sale-9000', amount: 200 });
    expect(data.sales()[0].due).toBe(0);
  });
});

describe('Party opening balance helpers', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sums the sales book from posted sales, vouchers, notes and receipts', () => {
    const { data } = setup();
    data.products.set([product({ stock: 100 })]);
    data.parties.set([party()]);
    sale(data, {
      items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 3, unit: 'pcs', salesPrice: 100, total: 300 }],
      total: 300, paid: 100, due: 200, paymentStatus: 'Partially Paid'
    });
    sale(data, { status: 'Cancelled', total: 500, paid: 0, due: 500 });
    credit(data, { amount: 20 });
    data.recordPayment({ partyId: 1, partyName: 'Customer', partyType: 'Customer', amount: 100, discount: 10, mode: 'Cash', date: '2026-11-11', note: '' });
    // 300 billed, 100 paid in the voucher, 20 credit note, 110 receipt.
    expect(data.partyBookMovement(data.parties()[0], 'sales')).toBe(70);
    expect(data.partyOpeningBalance(data.parties()[0], 'sales')).toBe(0);
  });

  it('ignores draft and cancelled supplier returns in the purchase book', () => {
    const { data } = setup();
    data.products.set([product({ stock: 100 })]);
    data.parties.set([party({ id: 2, name: 'Supplier', type: 'Supplier', roles: ['Supplier'] })]);
    purchase(data, { total: 160, paid: 40, due: 120 });
    supplierReturn(data, { amount: 20, status: 'Completed' });
    supplierReturn(data, { amount: 50, status: 'Draft' });
    supplierReturn(data, { amount: 30, status: 'Cancelled' });
    data.recordPayment({ partyId: 2, partyName: 'Supplier', partyType: 'Supplier', amount: 50, discount: 0, mode: 'Cash', date: '2026-11-11', note: '' });
    // 160 billed, 40 paid in the voucher, 20 posted return, 50 receipt.
    expect(data.partyBookMovement(data.parties()[0], 'purchase')).toBe(50);
    expect(data.partyOpeningBalance(data.parties()[0], 'purchase')).toBe(0);
  });

  it('reports the opening baked into an imported due so a correction replaces it', () => {
    const { data } = setup();
    const imported = party({ id: 5, name: 'Legacy', salesTotal: 1000, salesPaid: 200, salesDue: 700 });
    data.parties.set([imported]);
    expect(data.partyOpeningBalance(imported, 'sales')).toBe(700);
    // Correcting the opening to 400 must leave the due at exactly 400.
    data.updateParty({ ...imported, openingBalance: 400, openingBalanceType: 'Pay', salesDue: 400 });
    expect(data.partyOpeningBalance(data.parties()[0], 'sales')).toBe(400);
    expect(data.parties()[0].salesDue).toBe(400);
  });

  it('keeps document movement and opening stable after a party rename', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party()]);
    sale(data, { partyId: 1, total: 100, paid: 0, due: 100 });
    const before = data.partyOpeningBalance(data.parties()[0], 'sales');

    data.updateParty({ ...data.parties()[0], name: 'Renamed Customer' });

    expect(data.partyBookMovement(data.parties()[0], 'sales')).toBe(100);
    expect(data.partyOpeningBalance(data.parties()[0], 'sales')).toBe(before);
    expect(data.parties()[0].salesDue).toBe(100);
  });

  it('includes standalone battery vouchers but not sale adjustments in movement', () => {
    const { data } = setup();
    const customer = data.addParty(party({ name: 'Battery Customer' }) as unknown as Omit<Party, 'id'>);
    data.addBatteryVoucher({
      type: 'sale', date: '2026-11-14', partyName: customer.name, partyId: customer.id,
      lot: '', lines: [], totalKg: 1, total: 800, cost: 600, cash: 300, bank: 0, mobile: 0,
      ref: '', paid: 300, due: 500, notes: '', preparedBy: 'Admin', createdAt: new Date().toISOString()
    });
    data.addBatteryVoucher({
      type: 'sale', date: '2026-11-14', partyName: customer.name, partyId: customer.id,
      lot: '', lines: [], totalKg: 1, total: 900, cost: 600, cash: 0, bank: 0, mobile: 0,
      ref: '', paid: 0, due: 900, notes: '', preparedBy: 'Admin', createdAt: new Date().toISOString(),
      source: 'sale-adjustment', saleInvoice: 'Sale-9000'
    });

    expect(data.partyBookMovement(data.parties()[0], 'sales')).toBe(500);
    expect(data.partyOpeningBalance(data.parties()[0], 'sales')).toBe(0);
  });

  it('uses the receipt side for a party that is both customer and supplier', () => {
    const { data } = setup();
    data.parties.set([party({ roles: ['Customer', 'Supplier'], salesDue: 100, due: 100 })]);
    data.recordPayment({ partyId: 1, partyName: 'Customer', partyType: 'Supplier', side: 'sales', amount: 100, discount: 0, mode: 'Cash', date: '2026-11-11', note: '' });

    expect(data.partyBookMovement(data.parties()[0], 'sales')).toBe(-100);
    expect(data.partyBookMovement(data.parties()[0], 'purchase')).toBe(0);
    expect(data.payments()[0].side).toBe('sales');
  });

  it('seeds a legacy opening without changing the current due and is idempotent', () => {
    const { data } = setup();
    data.parties.set([party({ id: 5, name: 'Legacy', salesTotal: 1000, salesPaid: 200, salesDue: 700 })]);

    const plan = data.planPartyBalanceRepairs();
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      partyId: 5, side: 'sales', kind: 'opening-baseline',
      openingBefore: 0, openingAfter: 700, dueBefore: 700, dueAfter: 700,
      totalBefore: 1000, totalAfter: 0, paidBefore: 200, paidAfter: 0
    });

    expect(data.applyPartyBalanceRepairs(plan).skipped).toHaveLength(0);
    expect(data.parties()[0]).toMatchObject({
      openingBalance: 700, openingBalanceType: 'Pay', salesDue: 700, salesTotal: 0, salesPaid: 0
    });
    expect(data.planPartyBalanceRepairs()).toHaveLength(0);
  });

  it('repairs an unsupported due mismatch from the stored opening and documents', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party({ openingBalance: 202322, openingBalanceType: 'Pay' })]);
    sale(data, {
      items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 1, unit: 'pcs', salesPrice: 104940, total: 104940 }],
      total: 104940, paid: 75000, due: 29940, paymentStatus: 'Partially Paid'
    });
    data.updateParty({
      ...data.parties()[0], salesTotal: 73540, salesPaid: 45000, salesDue: 249571,
      total: 73540, paid: 45000, due: 249571
    });

    const plan = data.planPartyBalanceRepairs();
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      kind: 'balance-correction', movement: 29940,
      dueBefore: 249571, dueAfter: 232262,
      totalBefore: 73540, totalAfter: 104940,
      paidBefore: 45000, paidAfter: 75000
    });

    data.applyPartyBalanceRepairs(plan);
    expect(data.parties()[0].salesDue).toBe(232262);
    expect(data.partyOpeningBalance(data.parties()[0], 'sales')).toBe(202322);
    expect(data.planPartyBalanceRepairs()).toHaveLength(0);
  });

  it('skips a stale repair plan instead of overwriting a newer document', () => {
    const { data } = setup();
    data.products.set([product({ stock: 10 })]);
    data.parties.set([party({ openingBalance: 100, openingBalanceType: 'Pay' })]);
    sale(data, { total: 100, paid: 0, due: 100 });
    data.updateParty({ ...data.parties()[0], salesDue: 999 });
    const plan = data.planPartyBalanceRepairs();

    sale(data, { total: 50, paid: 0, due: 50 });
    const result = data.applyPartyBalanceRepairs(plan);

    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(data.parties()[0].salesDue).toBe(1049);
  });
});

describe('Payment promise reminders', () => {
  afterEach(() => TestBed.resetTestingModule());

  function withDue(data: DataService, amount: number) {
    data.products.set([product({ stock: 500 })]);
    data.parties.set([party()]);
    const quantity = amount / 100;
    sale(data, {
      items: [{ id: 1, productId: 10, productName: 'Battery', quantity, unit: 'pcs', salesPrice: 100, total: amount }],
      total: amount, paid: 0, due: amount, paymentStatus: 'Unpaid'
    });
  }

  it('moves the date without touching the due and keeps the old date in history', () => {
    const { data } = setup();
    withDue(data, 5000);
    data.setPaymentPromise(1, { date: '2099-01-10', amount: 2000, note: 'called the customer' });
    data.setPaymentPromise(1, { date: '2099-01-15', amount: 2000 });

    const moved = data.parties()[0];
    expect(moved.salesDue).toBe(5000);
    expect(moved.paymentPromise?.amount).toBe(2000);
    expect(moved.paymentPromise?.history.at(-1)).toMatchObject({ kind: 'date', oldDate: '2099-01-10', date: '2099-01-15' });
    expect(moved.paymentPromise?.history[0]).toMatchObject({ kind: 'set', text: 'called the customer' });
    expect(promiseRemaining(moved)).toBe(2000);
  });

  it('a partial receipt shrinks the promise and the last receipt completes it', () => {
    const { data } = setup();
    withDue(data, 5000);
    data.setPaymentPromise(1, { date: '2099-01-10', amount: 2000 });
    data.recordPayment({ partyId: 1, partyName: 'Customer', partyType: 'Customer', amount: 800, discount: 0, mode: 'Cash', date: '2026-11-11', note: '' });
    expect(promiseRemaining(data.parties()[0])).toBe(1200);

    data.recordPayment({ partyId: 1, partyName: 'Customer', partyType: 'Customer', amount: 1200, discount: 0, mode: 'Cash', date: '2026-11-11', note: '' });
    expect(promiseRemaining(data.parties()[0])).toBe(0);
    expect(data.parties()[0].paymentPromise?.history.at(-1)?.kind).toBe('done');
  });

  it('never promises more than the party actually owes', () => {
    const { data } = setup();
    withDue(data, 1000);
    data.setPaymentPromise(1, { date: '2099-01-10', amount: 3000 });
    expect(promiseRemaining(data.parties()[0])).toBe(1000);
  });
});

describe('Payment correction', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reverses the old receipt before applying the corrected amount', () => {
    const { data } = setup();
    data.products.set([product({ stock: 100 })]);
    data.parties.set([party()]);
    sale(data, { items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 5, unit: 'pcs', salesPrice: 100, total: 500 }], total: 500, paid: 0, due: 500, paymentStatus: 'Unpaid' });
    const receipt = data.recordPayment({ partyId: 1, partyName: 'Customer', partyType: 'Customer', amount: 100, discount: 0, mode: 'Cash', date: '2026-11-11', note: 'typo' });
    expect(data.parties()[0].salesDue).toBe(400);
    expect(data.parties()[0].salesPaid).toBe(100);

    const updated = data.updatePayment(receipt.id, { amount: 250, date: '2026-11-12', note: 'corrected' });

    expect(updated).toMatchObject({ amount: 250, note: 'corrected', date: '2026-11-12', advance: 0 });
    expect(data.parties()[0].salesDue).toBe(250);
    expect(data.parties()[0].salesPaid).toBe(250);
    expect(data.payments()).toHaveLength(1);
  });

  it('turns a shrunk overpayment back into a plain settlement with no advance', () => {
    const { data } = setup();
    data.products.set([product({ stock: 100 })]);
    data.parties.set([party()]);
    sale(data, { items: [{ id: 1, productId: 10, productName: 'Battery', quantity: 5, unit: 'pcs', salesPrice: 100, total: 500 }], total: 500, paid: 0, due: 500, paymentStatus: 'Unpaid' });
    const receipt = data.recordPayment({ partyId: 1, partyName: 'Customer', partyType: 'Customer', amount: 800, discount: 0, mode: 'Cash', date: '2026-11-11', note: '' });
    expect(data.parties()[0].salesDue).toBe(0);
    expect(data.parties()[0].salesAdvance).toBe(300);

    data.updatePayment(receipt.id, { amount: 200 });

    expect(data.parties()[0].salesDue).toBe(300);
    expect(data.parties()[0].salesPaid).toBe(200);
    expect(data.parties()[0].salesAdvance).toBe(0);
  });

  it('reports a missing receipt instead of throwing', () => {
    const { data } = setup();
    expect(data.updatePayment(999, { amount: 10 })).toBeNull();
  });
});
