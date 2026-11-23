import { CreditNoteItem, Product, Sale, SaleItem, SalesReturn } from '../services/data';
import {
  findProductForLine, findVariantForLine, noteDiscountAmount, orderDiscountAmount,
  productProfitRows, returnedItemsOf, soldItemsOf
} from './report-analytics';

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

function creditNote(items: CreditNoteItem[], overrides: Partial<SalesReturn> = {}): SalesReturn {
  return {
    id: 1, creditNoteNo: 'CRN-1', date: '2026-11-10', invoiceNumber: 'Sale-1',
    customerName: 'Walk-in', items, amount: 0, reason: '', restock: true,
    status: 'Posted', createdAt: '2026-11-10T10:00:00Z',
    ...overrides
  } as SalesReturn;
}

const bearing = product({
  id: 10, name: 'Bearing  F & D', type: 'variant', purchasePrice: 24, salesPrice: 40, stock: 100,
  variants: [
    { id: 101, variationId: 1, variationName: 'Size', variantValue: '6202', itemCode: '', purchasePrice: 31, wholesalePrice: 0, salesPrice: 40, openingStock: 60 },
    { id: 102, variationId: 1, variationName: 'Size', variantValue: '6205', itemCode: '', purchasePrice: 74, wholesalePrice: 0, salesPrice: 90, openingStock: 40 }
  ]
} as Product);

describe('report analytics', () => {
  it('costs a variant line at the variant purchase price, not the parent price', () => {
    const items = soldItemsOf(sale([
      line({ id: 1, productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 10, total: 500 })
    ]), [bearing]);

    expect(items[0].unitCost).toBe(31);
    expect(items[0].baseQty).toBe(10);

    const [row] = productProfitRows(items);
    expect(row.name).toBe('Bearing  F & D - 6202');
    expect(row.cost).toBe(310);
    expect(row.revenue).toBe(500);
    expect(row.profit).toBe(190);
  });

  it('resolves a legacy variant line from the variant value in its name', () => {
    const items = soldItemsOf(sale([
      line({ id: 1, productId: 10, productName: 'Bearing  F & D - 6205', quantity: 2, total: 180 })
    ]), [bearing]);

    expect(items[0].variant?.id).toBe(102);
    expect(items[0].unitCost).toBe(74);
    expect(productProfitRows(items)[0].cost).toBe(148);
  });

  it('matches the product by id even when its name changed after the sale', () => {
    const renamed = product({ id: 20, name: '17  ডিফেন্সিয়াল/হাড়ির খোল (ইজিবাইক) 3 কেজি', purchasePrice: 1000 });
    const items = soldItemsOf(sale([
      line({ id: 1, productId: 20, productName: '17 হাড়ির খোল (ইজিবাইক) 3 kg', quantity: 3, total: 3450 })
    ]), [renamed]);

    expect(items[0].unitCost).toBe(1000);
    expect(productProfitRows(items)[0]).toMatchObject({ cost: 3000, revenue: 3450, profit: 450 });
  });

  it('falls back to an exact name only, never a shared prefix', () => {
    const tubeA = product({ id: 30, name: '28*1.5 1/2 Tube A', purchasePrice: 100 });
    const tubeB = product({ id: 31, name: '28*1.5 1/2 Tube B Long Name', purchasePrice: 120 });

    expect(findProductForLine([tubeA, tubeB], { productName: '28*1.5 1/2 Tube B Long Name' })?.id).toBe(31);
    expect(findProductForLine([tubeA, tubeB], { productName: '28*1.5 1/2 Tube C' })).toBeUndefined();
  });

  it('does not treat the bare parent name as a variant match', () => {
    expect(findVariantForLine(bearing, { productName: 'Bearing  F & D' })).toBeUndefined();
  });

  it('shares a fixed order discount across the lines by value', () => {
    const items = soldItemsOf(sale([
      line({ id: 1, productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 1, total: 600 }),
      line({ id: 2, productId: 10, variantId: 102, productName: 'Bearing  F & D', quantity: 1, total: 400 })
    ], { orderDiscount: 50, orderDiscountType: 'fixed' }), [bearing]);

    expect(items.map(item => item.netRevenue)).toEqual([570, 380]);
  });

  it('converts a percentage order discount into money before sharing it', () => {
    expect(orderDiscountAmount({ orderDiscount: 10, orderDiscountType: 'percent' }, 1000)).toBe(100);

    const items = soldItemsOf(sale([
      line({ id: 1, productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 1, total: 250 }),
      line({ id: 2, productId: 10, variantId: 102, productName: 'Bearing  F & D', quantity: 1, total: 750 })
    ], { orderDiscount: 10, orderDiscountType: 'percent' }), [bearing]);

    expect(items.map(item => item.netRevenue)).toEqual([225, 675]);
  });

  it('never discounts more than the items total', () => {
    expect(orderDiscountAmount({ orderDiscount: 500, orderDiscountType: 'fixed' }, 300)).toBe(300);
  });

  it('costs extra units in base units', () => {
    const rice = product({ id: 40, name: 'Rice', unit: 'gram', purchasePrice: 2 });
    const items = soldItemsOf(sale([
      line({ id: 1, productId: 40, productName: 'Rice', quantity: 2, unitFactor: 1000, unit: 'kg', total: 7000 })
    ]), [rice]);

    expect(items[0].baseQty).toBe(2000);
    expect(productProfitRows(items)[0].cost).toBe(4000);
  });

  it('groups the same variant sold under old and new line names into one row', () => {
    const items = soldItemsOf(sale([
      line({ id: 1, productId: 10, variantId: 101, productName: 'Bearing  F & D - 6202', quantity: 1, total: 40 }),
      line({ id: 2, productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 2, total: 80 })
    ]), [bearing]);

    const rows = productProfitRows(items);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ qty: 3, revenue: 120, cost: 93, profit: 27 });
  });

  it('reverses both revenue and cost when a credit note restocks the goods', () => {
    const sold = soldItemsOf(sale([
      line({ id: 1, productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 10, total: 500 })
    ]), [bearing]);
    const returned = returnedItemsOf(creditNote([
      { productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 2, unitPrice: 40, total: 80 }
    ]), [bearing]);

    expect(returned[0].baseQty).toBe(-2);
    expect(returned[0].netRevenue).toBe(-80);

    const [row] = productProfitRows([...sold, ...returned]);
    expect(row).toMatchObject({ qty: 8, revenue: 420, cost: 248, profit: 172 });
  });

  it('keeps the cost of a damaged return, so the loss is visible', () => {
    const sold = soldItemsOf(sale([
      line({ id: 1, productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 10, total: 500 })
    ]), [bearing]);
    const returned = returnedItemsOf(creditNote([
      { productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 2, unitPrice: 40, total: 80 }
    ], { restock: false }), [bearing]);

    expect(returned[0].unitCost).toBe(0);
    const [row] = productProfitRows([...sold, ...returned]);
    expect(row).toMatchObject({ qty: 8, revenue: 420, cost: 310, profit: 110 });
  });

  it('shares the credit note discount over its lines before reversing revenue', () => {
    expect(noteDiscountAmount({ discount: 10, discountType: 'percent' }, 1000)).toBe(100);

    const returned = returnedItemsOf(creditNote([
      { productId: 10, variantId: 101, productName: 'Bearing  F & D', quantity: 1, unitPrice: 40, total: 600 },
      { productId: 10, variantId: 102, productName: 'Bearing  F & D', quantity: 1, unitPrice: 90, total: 400 }
    ], { discount: 50, discountType: 'fixed' }), [bearing]);

    expect(returned.map(item => item.netRevenue)).toEqual([-570, -380]);
  });

  it('costs a returned line in base units when it was sold in a larger unit', () => {
    const rice = product({ id: 40, name: 'Rice', unit: 'gram', purchasePrice: 2 });
    const returned = returnedItemsOf(creditNote([
      { productId: 40, productName: 'Rice', quantity: 1, unit: 'kg', unitFactor: 1000, unitPrice: 3500, total: 3500 }
    ]), [rice]);

    expect(returned[0].baseQty).toBe(-1000);
    expect(productProfitRows(returned)[0]).toMatchObject({ qty: -1000, revenue: -3500, cost: -2000 });
  });
});
