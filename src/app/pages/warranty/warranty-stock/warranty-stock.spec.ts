import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { vi } from 'vitest';
import { WarrantyStock } from './warranty-stock';
import type { WarrantyStockMovement } from '../../../services/data';
import { DataService } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';
import { SessionService } from '../../../services/session';

const movement: WarrantyStockMovement = {
  id: 7, date: '2026-11-10', pool: 'received', quantity: 5, productId: 10,
  productName: 'Battery', serialNumber: 'S1', unit: 'pcs', reason: 'receipt',
  refNo: 'C1', createdAt: '2026-11-10T00:00:00.000Z'
};

function setup(role: 'Admin' | 'Salesman') {
  const confirm = vi.fn(async () => true);
  const log = vi.fn();
  const adjust = vi.fn(() => ({ ok: true }));
  const update = vi.fn(() => ({ ok: true }));
  const remove = vi.fn(() => ({ ok: true }));
  const movements = signal<WarrantyStockMovement[]>([movement]);
  TestBed.configureTestingModule({ providers: [
    { provide: ActivatedRoute, useValue: { snapshot: { data: { stockView: 'balances' } } } },
    {
      provide: DataService, useValue: {
        warrantyStockMovements: movements,
        warrantySettings: signal({ allowNegativeStock: false }),
        products: signal([]),
        warrantyStockKey: (productId?: number, productName = '', unit = '') => `${productId}|${productName}|${unit}`,
        warrantyStockOf: () => ({ received: 5, replacement: 0 }),
        adjustWarrantyStock: adjust,
        updateWarrantyStockMovement: update,
        deleteWarrantyStockMovement: remove
      }
    },
    { provide: NotificationService, useValue: { confirm, success: vi.fn(), error: vi.fn() } },
    { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en } },
    { provide: SessionService, useValue: { currentUser: signal({ id: 1, name: 'Tester', username: 'tester', role }), log } }
  ] });
  const component = TestBed.runInInjectionContext(() => new WarrantyStock());
  return { component, confirm, log, adjust, update, remove };
}

describe('WarrantyStock admin-only data changes', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('ignores every edit and delete attempt from a non-admin', async () => {
    const { component, confirm, adjust, update, remove } = setup('Salesman');
    component.openAdjustment(1);
    component.openSupplier({ ...movement, pools: ['received'], lastDates: { received: '2026-11-10', replacement: '' } } as never);
    component.openMovementEdit(movement);
    component.saveAdjustment();
    await component.deleteMovement(movement);
    expect(component.isAdmin()).toBe(false);
    expect(component.adjustmentOpen()).toBe(false);
    expect(component.supplierOpen()).toBe(false);
    expect(component.editingMovement()).toBeNull();
    expect(adjust).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('lets an admin edit a ledger row and records an audit entry', () => {
    const { component, update, log } = setup('Admin');
    component.openMovementEdit(movement);
    expect(component.editingMovement()?.id).toBe(7);
    expect(component.editForm().quantity).toBe(5);
    component.setEdit('quantity', 3);
    component.setEdit('note', 'fixed');
    component.saveMovementEdit();
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ quantity: 3, note: 'fixed', pool: 'received' }));
    expect(log).toHaveBeenCalledWith('Warranty Stock Edited', expect.stringContaining('Battery'));
    expect(component.editingMovement()).toBeNull();
  });

  it('confirms before deleting and logs the removal', async () => {
    const { component, confirm, remove, log } = setup('Admin');
    await component.deleteMovement(movement);
    expect(confirm).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(7);
    expect(log).toHaveBeenCalledWith('Warranty Stock Deleted', expect.stringContaining('+5 pcs'));
  });
});
