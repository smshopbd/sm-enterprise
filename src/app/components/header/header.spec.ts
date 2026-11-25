import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { Header } from './header';
import { DataService } from '../../services/data';
import { LoadingService } from '../../services/loading';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import { SessionService } from '../../services/session';
import { CloudService } from '../../services/cloud';

function setup() {
  const warehouses = signal(['Main Warehouse', 'Branch A', 'Branch B']);
  const lowStockProducts = signal<{ id: number; name: string; stock: number; minQty?: number }[]>([]);
  const log = vi.fn();
  const pendingRows = signal(0);
  const retryNow = vi.fn(async () => undefined);
  TestBed.configureTestingModule({ providers: [
    { provide: DataService, useValue: { warehouses, lowStockProducts, addExpense: vi.fn() } },
    {
      provide: NotificationService,
      useValue: {
        prompt: vi.fn(async () => ''),
        confirm: vi.fn(async () => true),
        error: vi.fn(),
        success: vi.fn()
      }
    },
    {
      provide: SessionService,
      useValue: {
        currentUser: signal({ id: 1, name: 'Admin', username: 'admin', role: 'Admin' }),
        log,
        canSee: () => true,
        has: () => true,
        logout: vi.fn()
      }
    },
    {
      provide: PreferencesService,
      useValue: {
        txt: (_bn: string, en: string) => en,
        t: (key: string) => key,
        language: signal('en'),
        dark: signal(false),
        toggleLanguage: vi.fn(),
        toggleDark: vi.fn()
      }
    },
    { provide: LoadingService, useValue: { syncing: signal(false), online: signal(true) } },
    {
      provide: CloudService,
      useValue: {
        pendingRows,
        retryNow,
        status: signal('online'),
        statusMessage: signal(''),
        config: signal({})
      }
    },
    { provide: Router, useValue: { navigate: vi.fn() } }
  ] });
  const component = TestBed.runInInjectionContext(() => new Header());
  return { component, warehouses, lowStockProducts, log, pendingRows, retryNow };
}

describe('Header warehouse search', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('filters warehouses by a case-insensitive query and restores the full list when cleared', () => {
    const { component } = setup();
    expect(component.filteredWarehouses().length).toBe(3);

    component.onWarehouseQuery({ target: { value: 'BRANCH' } } as unknown as Event);
    expect(component.filteredWarehouses()).toEqual(['Branch A', 'Branch B']);

    component.onWarehouseQuery({ target: { value: '  BRANCH B ' } } as unknown as Event);
    expect(component.filteredWarehouses()).toEqual(['Branch B']);

    component.onWarehouseQuery({ target: { value: '' } } as unknown as Event);
    expect(component.filteredWarehouses().length).toBe(3);
  });

  it('selects the first match on Enter and closes the picker', () => {
    const { component } = setup();
    component.showWarehouseDropdown.set(true);
    component.onWarehouseQuery({ target: { value: 'branch' } } as unknown as Event);

    component.onWarehouseKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(component.selectedWarehouse()).toBe('Branch A');
    expect(component.showWarehouseDropdown()).toBe(false);
    expect(component.warehouseQuery()).toBe('');
  });

  it('closes and clears the query on Escape', () => {
    const { component } = setup();
    component.showWarehouseDropdown.set(true);
    component.onWarehouseQuery({ target: { value: 'branch' } } as unknown as Event);

    component.onWarehouseKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.showWarehouseDropdown()).toBe(false);
    expect(component.warehouseQuery()).toBe('');
    expect(component.selectedWarehouse()).toBe('SM Warehouse');
  });
});

describe('Header pending uploads', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows pending rows and retries them from the header', async () => {
    const { component, pendingRows, retryNow } = setup();
    pendingRows.set(3);

    expect(component.pendingSyncTitle()).toContain('3 saved records');
    await component.retrySync();
    expect(retryNow).toHaveBeenCalledTimes(1);
    expect(component.retryingSync()).toBe(false);
  });
});

describe('Header stock alerts', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('splits the bell into out-of-stock and low-stock groups and links each row to its filter', () => {
    const { component, lowStockProducts } = setup();
    lowStockProducts.set([
      { id: 1, name: 'A', stock: 0 },
      { id: 2, name: 'B', stock: 3, minQty: 5 }
    ]);

    expect(component.alertCount()).toBe(2);
    expect(component.outOfStock().map(p => p.id)).toEqual([1]);
    expect(component.lowStockOnly().map(p => p.id)).toEqual([2]);
    expect(component.stockAlertMode({ stock: 0 })).toBe('out');
    expect(component.stockAlertMode({ stock: 2 })).toBe('low');
    expect(component.alertThreshold({ minQty: 8 })).toBe(8);
    expect(component.alertThreshold({})).toBe(5);
  });
});
