import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Stock } from './stock';
import type { Product, StockAdjustment } from '../../services/data';
import { DataService } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 10, name: 'Battery', code: 'B10', rack: '', warehouse: 'SM Warehouse', type: 'single',
    category: '', brand: '', model: '', stock: 5, unit: 'pcs', salesPrice: 100, purchasePrice: 80,
    wholesalePrice: 90, ...overrides
  };
}

function adjustment(overrides: Partial<StockAdjustment> = {}): StockAdjustment {
  return {
    id: 1, date: '2026-11-11', productId: 10, productName: 'Battery', code: 'B10', unit: 'pcs',
    previousStock: 5, newStock: 8, delta: 3, variants: [], reason: 'found',
    createdAt: '2026-11-11T00:00:00.000Z', ...overrides
  };
}

function setup(role: 'Admin' | 'Salesman', overrides: Partial<Product> = {}) {
  const products = signal<Product[]>([product(overrides)]);
  const adjustments = signal<StockAdjustment[]>([]);
  const adjust = vi.fn((): { ok: boolean; error?: string; adjustment?: StockAdjustment } => ({
    ok: true, adjustment: adjustment()
  }));
  const log = vi.fn();
  const success = vi.fn();
  TestBed.configureTestingModule({ providers: [
    {
      provide: DataService, useValue: {
        products,
        lowStockProducts: () => [],
        stockValueSales: () => 0,
        stockAdjustments: adjustments,
        adjustProductStock: adjust,
        exportToExcel: vi.fn()
      }
    },
    { provide: NotificationService, useValue: { success, error: vi.fn(), confirm: vi.fn() } },
    { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en } },
    { provide: SessionService, useValue: { currentUser: signal({ id: 1, name: 'Tester', username: 'tester', role }), log } }
  ] });
  const component = TestBed.runInInjectionContext(() => new Stock());
  return { component, products, adjust, log, success };
}

const input = (value: string) => ({ target: { value } }) as unknown as Event;

describe('Stock reconciliation page', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('ignores open and save attempts from a non-admin', () => {
    const { component, adjust } = setup('Salesman');
    component.openAdjust(component.dataService.products()[0]);
    expect(component.isAdmin()).toBe(false);
    expect(component.adjustOpen()).toBe(false);
    component.saveAdjustment();
    expect(adjust).not.toHaveBeenCalled();
  });

  it('never opens the reconcile modal for a service product', () => {
    const { component } = setup('Admin', { type: 'service', stock: 0 });
    component.openAdjust(component.dataService.products()[0]);
    expect(component.adjustOpen()).toBe(false);
  });

  it('seeds the counted value, shows the live change and saves the adjustment with an audit entry', () => {
    const { component, adjust, log, success } = setup('Admin');
    component.openAdjust(component.dataService.products()[0]);
    expect(component.adjustOpen()).toBe(true);
    expect(component.adjustValue()).toBe(5);
    expect(component.adjustDelta()).toBe(0);

    component.onCount(input('8'));
    component.onReason(input('count'));
    component.onNote(input('extra pieces found'));
    expect(component.adjustDelta()).toBe(3);
    expect(component.adjustNextStock()).toBe(8);

    component.saveAdjustment();
    expect(adjust).toHaveBeenCalledWith(10, { quantity: 8 }, { reason: 'count', note: 'extra pieces found', user: 'Tester' });
    expect(log).toHaveBeenCalledWith('Stock Reconciled', expect.stringContaining('Battery: 5 → 8 (+3 pcs)'));
    expect(success).toHaveBeenCalledOnce();
    expect(component.adjustOpen()).toBe(false);
  });

  it('keeps the modal open and shows the translated error when the save is rejected', () => {
    const { component, adjust } = setup('Admin');
    adjust.mockReturnValueOnce({ ok: false, error: 'nochange' });
    component.openAdjust(component.dataService.products()[0]);
    component.saveAdjustment();
    expect(component.adjustError()).toBe('The counted stock matches the current stock — nothing to change.');
    expect(component.adjustOpen()).toBe(true);
  });

  it('counts variant products per variant and sums the change into the parent stock', () => {
    const { component, adjust } = setup('Admin', {
      type: 'variant', stock: 5,
      variants: [
        { id: 1, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 2 },
        { id: 2, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 3 }
      ]
    });
    component.openAdjust(component.dataService.products()[0]);
    expect(component.variantValue(1)).toBe(2);
    component.onVariantCount(1, input('4'));
    expect(component.adjustDelta()).toBe(2);
    expect(component.adjustNextStock()).toBe(7);

    component.saveAdjustment();
    expect(adjust).toHaveBeenCalledWith(10, { variants: { 1: 4, 2: 3 } }, expect.objectContaining({ user: 'Tester' }));
  });

  it('locks the page scroll container, not just <body>, while the drawer is open', () => {
    const main = document.createElement('main');
    main.className = 'app-scroll';
    document.body.appendChild(main);
    document.body.style.overflow = '';
    try {
      const { component } = setup('Admin');
      component.openAdjust(component.dataService.products()[0]);
      expect(main.style.overflow).toBe('hidden');
      expect(document.body.style.overflow).toBe('hidden');
      component.closeAdjust();
      expect(main.style.overflow).toBe('');
      expect(document.body.style.overflow).toBe('');
    } finally {
      document.body.style.overflow = '';
      main.remove();
    }
  });
});
