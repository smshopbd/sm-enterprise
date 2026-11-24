import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { Products } from './products';
import type { Product, Purchase, Sale } from '../../../services/data';
import { DataService } from '../../../services/data';
import { MediaService } from '../../../services/media';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';

const battery: Product = {
  id: 10, name: 'Battery', code: 'B10', rack: '', warehouse: 'SM Warehouse', type: 'single',
  category: 'Parts', brand: 'F&D', model: '', stock: 5, unit: 'pcs', salesPrice: 100,
  purchasePrice: 80, wholesalePrice: 90
};

function purchase(overrides: Partial<Purchase>): Purchase {
  return {
    id: 1, invoice: 'PUR-1', warehouse: 'SM Warehouse', date: '01-11-2026', supplierName: 'Supplier',
    preparedBy: 'Admin', status: 'Received', total: 0, paid: 0, due: 0, paymentStatus: 'Unpaid',
    nextPayDate: '', notes: '', items: [], ...overrides
  };
}

function sale(overrides: Partial<Sale>): Sale {
  return {
    id: 1, invoice: 'SAL-1', warehouse: 'SM Warehouse', date: '01-11-2026', customerName: 'Walk-in',
    preparedBy: 'Admin', status: 'Completed', total: 0, paid: 0, due: 0, paymentStatus: 'Unpaid',
    nextPayDate: '', notes: '', items: [], ...overrides
  };
}

function setup(purchases: Purchase[], params: Record<string, string> = {}, sales: Sale[] = []) {
  TestBed.configureTestingModule({ providers: [
    {
      provide: DataService, useValue: {
        products: signal<Product[]>([battery]),
        purchases: signal<Purchase[]>(purchases),
        sales: signal<Sale[]>(sales)
      }
    },
    { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(params)) } },
    { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en } },
    { provide: NotificationService, useValue: {} },
    { provide: SessionService, useValue: { log: () => undefined } },
    { provide: MediaService, useValue: {} }
  ] });
  return TestBed.runInInjectionContext(() => new Products());
}

describe('Product details purchase history', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('collects every voucher that contains the product and reports how many pieces entered stock', () => {
    const component = setup([
      purchase({
        id: 101, invoice: 'PUR-101', date: '01-11-2026', status: 'Received',
        createdAt: '2026-11-01T10:00:00.000Z',
        items: [
          { id: 1, productId: 10, productName: 'Battery', itemCode: 'B10', unit: 'pcs', quantity: 2, purchasePrice: 80, subtotal: 160 },
          { id: 2, productId: 10, productName: 'Battery', itemCode: 'B10', unit: 'pcs', quantity: 3, purchasePrice: 75, subtotal: 225 },
          { id: 3, productId: 20, productName: 'Charger', itemCode: 'C20', unit: 'pcs', quantity: 9, purchasePrice: 50, subtotal: 450 }
        ]
      }),
      purchase({
        id: 102, invoice: 'PUR-102', date: '05-11-2026', status: 'Pending',
        createdAt: '2026-11-05T10:00:00.000Z',
        items: [
          { id: 4, productId: 0, productName: 'Battery', itemCode: '', unit: 'pcs', quantity: 4, purchasePrice: 70, subtotal: 0 }
        ]
      }),
      purchase({
        id: 103, invoice: 'PUR-103', date: '06-11-2026', createdAt: '2026-11-06T10:00:00.000Z',
        items: [
          { id: 5, productId: 20, productName: 'Charger', itemCode: 'C20', unit: 'pcs', quantity: 1, purchasePrice: 50, subtotal: 50 }
        ]
      })
    ]);

    component.viewProduct(battery);
    const rows = component.purchaseHistory();
    expect(rows.map(row => row.purchase.id)).toEqual([102, 101]);
    expect(rows.map(row => row.quantity)).toEqual([4, 5]);
    expect(rows.map(row => row.received)).toEqual([false, true]);
    expect(rows[1].amount).toBe(385);
    expect(rows[0].amount).toBe(280);

    expect(component.purchaseHistorySummary()).toEqual({
      entries: 2, receivedQty: 5, amount: 665, lastDate: '05-11-2026'
    });
  });

  it('still matches a voucher line after a re-import changed the product id but kept the item code', () => {
    const component = setup([
      purchase({
        id: 104, invoice: 'PUR-104', date: '07-11-2026', status: 'Received',
        createdAt: '2026-11-07T10:00:00.000Z',
        items: [
          { id: 6, productId: 999, productName: 'Old courier name', itemCode: 'B10', unit: 'pcs', quantity: 2, purchasePrice: 80, subtotal: 160 }
        ]
      })
    ]);
    component.viewProduct(battery);
    expect(component.purchaseHistory().map(row => row.purchase.id)).toEqual([104]);
    expect(component.purchaseHistorySummary().receivedQty).toBe(2);
  });

  it('reports an empty history for a product nobody purchased or when no drawer is open', () => {
    const component = setup([]);
    expect(component.purchaseHistory()).toEqual([]);
    expect(component.purchaseHistorySummary()).toEqual({ entries: 0, receivedQty: 0, amount: 0, lastDate: '' });
    component.viewProduct(battery);
    expect(component.purchaseHistorySummary().entries).toBe(0);
  });

  it('opens the list already filtered when the header bell links to ?stock=low', () => {
    const component = setup([], { stock: 'low' });
    expect(component.stockMode()).toBe('low');
    expect(component.stockFilterActive()).toBe(true);
  });

  it('applies both the stock filter and the product search from a bell row link', () => {
    const component = setup([], { stock: 'out', q: 'Battery' });
    expect(component.stockMode()).toBe('out');
    expect(component.searchQuery()).toBe('Battery');
  });
});

describe('Product list order', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the newest product first even when the saved collection is unordered', () => {
    const component = setup([]);
    const data = TestBed.inject(DataService);
    data.products.set([
      { ...battery, id: 5, name: 'Older' },
      { ...battery, id: 9, name: 'Newest' },
      { ...battery, id: 7, name: 'Middle' }
    ]);
    expect(component.rows().map(row => row.product.name)).toEqual(['Newest', 'Middle', 'Older']);
  });
});

describe('Product details sales history', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('collects every sale that contains the product and leaves cancelled vouchers out of the totals', () => {
    const component = setup([], {}, [
      sale({
        id: 201, invoice: 'SAL-201', date: '02-11-2026', customerName: 'Rahim',
        items: [
          { id: 1, productId: 10, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 },
          { id: 2, productId: 10, productName: 'Battery', quantity: 1, unit: 'pcs', salesPrice: 100, total: 100 },
          { id: 3, productId: 20, productName: 'Charger', quantity: 5, unit: 'pcs', salesPrice: 50, total: 250 }
        ]
      }),
      sale({
        id: 202, invoice: 'SAL-202', date: '08-11-2026', customerName: 'Karim',
        items: [
          { id: 4, productId: 10, productName: 'Battery', quantity: 3, unit: 'pcs', salesPrice: 100, total: 0 }
        ]
      }),
      sale({
        id: 203, invoice: 'SAL-203', date: '09-11-2026', status: 'Cancelled',
        items: [
          { id: 5, productId: 10, productName: 'Battery', quantity: 4, unit: 'pcs', salesPrice: 100, total: 400 }
        ]
      })
    ]);

    component.viewProduct(battery);
    const rows = component.salesHistory();
    expect(rows.map(row => row.sale.id)).toEqual([203, 202, 201]);
    expect(rows.map(row => row.quantity)).toEqual([4, 3, 3]);
    expect(rows.map(row => row.cancelled)).toEqual([true, false, false]);
    expect(rows[2].amount).toBe(300);
    expect(rows[1].amount).toBe(300);

    expect(component.salesHistorySummary()).toEqual({
      entries: 3, soldQty: 6, amount: 600, lastDate: '09-11-2026'
    });
  });

  it('still matches a line without a product id by the product name', () => {
    const component = setup([], {}, [
      sale({
        id: 204, invoice: 'SAL-204', date: '07-11-2026',
        items: [
          { id: 6, productName: 'Battery', quantity: 2, unit: 'pcs', salesPrice: 100, total: 200 }
        ]
      })
    ]);
    component.viewProduct(battery);
    expect(component.salesHistory().map(row => row.sale.id)).toEqual([204]);
    expect(component.salesHistorySummary().soldQty).toBe(2);
  });

  it('reports an empty history for a product nobody bought or when no drawer is open', () => {
    const component = setup([]);
    expect(component.salesHistory()).toEqual([]);
    expect(component.salesHistorySummary()).toEqual({ entries: 0, soldQty: 0, amount: 0, lastDate: '' });
    component.viewProduct(battery);
    expect(component.salesHistorySummary().entries).toBe(0);
  });
});

describe('Product edit stock', () => {
  afterEach(() => TestBed.resetTestingModule());

  function editSetup(existing: Product = { ...battery, openingStock: 10 }) {
    const saved: Product[] = [];
    TestBed.configureTestingModule({ providers: [
      {
        provide: DataService, useValue: {
          products: signal<Product[]>([existing]),
          updateProduct: (product: Product) => { saved.push(product); },
          addProduct: (product: Product) => { saved.push(product); }
        }
      },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
      { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en } },
      { provide: NotificationService, useValue: { toast: () => undefined } },
      { provide: SessionService, useValue: { log: () => undefined } },
      { provide: MediaService, useValue: {} }
    ] });
    const component = TestBed.runInInjectionContext(() => new Products());
    component.isEditMode.set(true);
    component.editingProductId.set(existing.id);
    Object.assign(component, {
      formName: existing.name, formSlug: 'battery', formType: existing.type,
      formWarehouse: 'SM Warehouse', formCategory: 'Parts', formUnit: 'pcs',
      formBarcodeSymbology: 'Code128', formCode: existing.code,
      formPurchasePrice: 80, formSalesPrice: 100,
      formOpeningStock: existing.openingStock ?? existing.stock,
      formCurrentStock: existing.stock
    });
    return { component, saved };
  }

  it('opens with the live stock number, not the historical opening stock', () => {
    const { component } = editSetup({ ...battery, stock: 20, openingStock: 0 });
    component.openEditModal({ ...battery, stock: 20, openingStock: 0 });
    expect(component.formCurrentStock).toBe(20);
  });

  it('stores exactly the stock number that was typed', () => {
    const { component, saved } = editSetup();
    component.formCurrentStock = 7;
    component.saveProductForm();
    expect(saved).toHaveLength(1);
    expect(saved[0].stock).toBe(7);
    expect(saved[0].openingStock).toBe(10);
  });

  it('keeps the current stock when the number is untouched', () => {
    const { component, saved } = editSetup();
    component.saveProductForm();
    expect(saved[0].stock).toBe(5);
  });

  it('refuses a negative stock number', () => {
    const { component, saved } = editSetup();
    component.formCurrentStock = -1;
    component.saveProductForm();
    expect(saved).toHaveLength(0);
    expect(component.formError()).toContain('negative');
  });

  it('moves the parent stock by the variant opening stock difference', () => {
    const { component, saved } = editSetup({
      ...battery, type: 'variant', stock: 10,
      variants: [
        { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'B10-A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 4 },
        { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B10-B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 6 }
      ]
    });
    component.addedVariants.set([
      { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'B10-A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 9 },
      { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B10-B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 6 }
    ]);
    component.saveProductForm();
    expect(saved).toHaveLength(1);
    expect(saved[0].openingStock).toBe(15);
    expect(saved[0].stock).toBe(15);
  });

  it('stores "১ প্যাকেট = ১৫ পিস" as 1/15 of the base unit and auto-prices the piece', () => {
    const { component, saved } = editSetup({ ...battery, unit: 'Packet', salesPrice: 450, wholesalePrice: 420 });
    component.formUnit = 'Packet';
    component.formSalesPrice = 450;
    component.addFormUnit();
    component.formUnits[0].name = 'PCS';
    component.formUnits[0].factor = 15;
    component.toggleUnitDirection(0);
    expect(component.formUnits[0].inverse).toBe(true);
    expect(component.autoUnitPrice(component.formUnits[0])).toBe('30');
    component.saveProductForm();
    expect(saved).toHaveLength(1);
    expect(saved[0].units?.[0]).toEqual({ name: 'PCS', factor: 0.066667, price: undefined });
  });

  it('keeps a per-unit price typed by hand', () => {
    const { component, saved } = editSetup({ ...battery, unit: 'Packet', salesPrice: 450 });
    component.formUnit = 'Packet';
    component.formSalesPrice = 450;
    component.addFormUnit();
    component.formUnits[0].name = 'PCS';
    component.formUnits[0].factor = 15;
    component.toggleUnitDirection(0);
    component.formUnits[0].price = 32;
    component.saveProductForm();
    expect(saved[0].units?.[0]).toEqual({ name: 'PCS', factor: 0.066667, price: 32 });
  });

  it('reopens a stored fractional factor as "১ প্যাকেট = ১৫ পিস"', () => {
    const { component } = editSetup({ ...battery, unit: 'Packet', units: [{ name: 'PCS', factor: 0.066667, price: 30 }] });
    component.openEditModal({ ...battery, unit: 'Packet', units: [{ name: 'PCS', factor: 0.066667, price: 30 }] });
    expect(component.formUnits[0]).toMatchObject({ name: 'PCS', factor: 15, inverse: true });
  });

  it('saves a blank conversion as a shared factor-1 unit with its own price', () => {
    const { component, saved } = editSetup({ ...battery, unit: 'গজ', salesPrice: 150 });
    component.formSalesPrice = 150;
    component.addFormUnit();
    component.formUnits[0].name = 'কেজি';
    component.formUnits[0].price = 800;
    component.saveProductForm();
    expect(saved).toHaveLength(1);
    expect(saved[0].units?.[0]).toEqual({ name: 'কেজি', factor: 1, price: 800 });
  });

  it('reopens a shared unit with an empty conversion box', () => {
    const product = { ...battery, unit: 'গজ', units: [{ name: 'কেজি', factor: 1, price: 800 }] };
    const { component } = editSetup(product);
    component.openEditModal(product);
    expect(component.formMultiUnit).toBe(true);
    expect(component.formUnits[0]).toMatchObject({ name: 'কেজি', factor: '', price: 800 });
  });

  it('turning the multi-unit mode off drops its rows', () => {
    const { component } = editSetup();
    component.addFormUnit();
    component.formUnits[0].name = 'কেজি';
    component.onMultiUnitToggle(false);
    expect(component.formMultiUnit).toBe(false);
    expect(component.formUnits).toEqual([]);
  });
});
