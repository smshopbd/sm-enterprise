import { CreditNoteItem, Product, Sale, SaleItem, SalesReturn } from '../services/data';
import { saleVoucherProfits, voucherProfitTotals } from './voucher-profit';

function product(overrides: Partial<Product> & Pick<Product, 'id' | 'name'>): Product {
  return {
    code: '', rack: '', type: 'single', category: 'Bearings', brand: '', model: '',
    stock: 0, unit: 'pcs', salesPrice: 0, purchasePrice: 0, wholesalePrice: 0,
    ...overrides
  } as Product;
}

function line(overrides: Partial<SaleItem>): SaleItem {
  return {
    id: 1, productName: 'Item', quantity: 1, unit: 'pcs',
    salesPrice: 0, total: 0, ...overrides
  } as SaleItem;
}

function sale(items: SaleItem[], overrides: Partial<Sale> = {}): Sale {
  return {
    id: 1, invoice: 'Sale-1', warehouse: 'W', date: '2026-11-01', customerName: 'Walk-in',
    preparedBy: 'Admin', status: 'Completed', total: 0, paid: 0, due: 0,
    paymentStatus: 'Paid', nextPayDate: '-', notes: '', items,
    ...overrides
  } as Sale;
}

function noteLine(): CreditNoteItem {
  return { productId: 10, productName: 'Bearing', quantity: 1, unitPrice: 50, total: 50 };
}

function creditNote(items: CreditNoteItem[], overrides: Partial<SalesReturn> = {}): SalesReturn {
  return {
    id: 1, creditNoteNo: 'CRN-1', date: '2026-11-10', invoiceNumber: 'Sale-1',
    customerName: 'Walk-in', items, amount: 0, reason: '', restock: true,
    status: 'Posted', createdAt: '2026-11-10T10:00:00Z',
    ...overrides
  } as SalesReturn;
}

const bearing = product({ id: 10, name: 'Bearing', purchasePrice: 30, salesPrice: 50 });

describe('voucher profit', () => {
  it('costs each line and keeps shipping/discount in the voucher total', () => {
    const rows = saleVoucherProfits([sale([
      line({ id: 1, productId: 10, productName: 'Bearing', quantity: 2, total: 100 }),
      line({ id: 2, productId: 10, productName: 'Bearing', quantity: 1, total: 50 })
    ], { total: 170, shipping: 20 })], [], [bearing]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      revenue: 170, returns: 0, netRevenue: 170, cost: 90, profit: 80,
      margin: 47.1, costIncomplete: false, adjustment: 20
    });
    expect(rows[0].lines.map(l => l.profit)).toEqual([40, 20]);
  });

  it('subtracts a posted credit note even when the note is dated later', () => {
    const rows = saleVoucherProfits([sale([
      line({ id: 1, productId: 10, productName: 'Bearing', quantity: 2, total: 100 })
    ], { total: 100 })], [
      creditNote([noteLine()], { amount: 50 })
    ], [bearing]);

    expect(rows[0]).toMatchObject({ revenue: 100, returns: 50, netRevenue: 50, cost: 30, profit: 20 });
    expect(rows[0].returnLines[0]).toMatchObject({ baseQty: -1, revenue: -50, cost: -30, profit: -20 });
  });

  it('keeps the cost of a damaged return so the loss shows', () => {
    const rows = saleVoucherProfits([sale([
      line({ id: 1, productId: 10, productName: 'Bearing', quantity: 2, total: 100 })
    ], { total: 100 })], [
      creditNote([noteLine()], { amount: 50, restock: false })
    ], [bearing]);

    expect(rows[0].cost).toBe(60);
    expect(rows[0].profit).toBe(-10);
    expect(rows[0].costIncomplete).toBe(false);
  });

  it('marks a voucher incomplete when a line has no purchase price, and totals skip it', () => {
    const noCost = product({ id: 20, name: 'Gift', purchasePrice: 0 });
    const rows = saleVoucherProfits([
      sale([line({ id: 1, productId: 20, productName: 'Gift', quantity: 1, total: 500 })], { id: 2, invoice: 'Sale-2', total: 500 }),
      sale([line({ id: 1, productId: 10, productName: 'Bearing', quantity: 1, total: 50 })], { id: 1, invoice: 'Sale-1', total: 50 })
    ], [], [bearing, noCost]);

    expect(rows[0].costIncomplete).toBe(true);
    expect(rows[1].costIncomplete).toBe(false);
    expect(voucherProfitTotals(rows)).toEqual({
      count: 2, complete: 1, incomplete: 1,
      revenue: 50, returns: 0, cost: 30, profit: 20, loss: 0
    });
  });

  it('ignores cancelled sales and unposted credit notes', () => {
    const rows = saleVoucherProfits([sale([
      line({ id: 1, productId: 10, productName: 'Bearing', quantity: 1, total: 50 })
    ], { total: 50 })], [
      creditNote([noteLine()], { amount: 50, status: 'Draft' })
    ], [bearing]);
    expect(rows[0].returns).toBe(0);

    expect(saleVoucherProfits([sale([], { status: 'Cancelled' })], [], [])).toEqual([]);
  });

  it('counts multi-unit lines in the base unit', () => {
    const sack = product({ id: 30, name: 'Cement', purchasePrice: 380, salesPrice: 450 });
    const rows = saleVoucherProfits([sale([
      line({ id: 1, productId: 30, productName: 'Cement', quantity: 2, unit: 'bag', unitFactor: 50, total: 900 })
    ], { total: 900 })], [], [sack]);

    expect(rows[0].qty).toBe(100);
    expect(rows[0].cost).toBe(38000);
    expect(rows[0].profit).toBe(-37100);
    expect(voucherProfitTotals(rows).loss).toBe(1);
  });
});
