import { Product } from '../services/data';
import { productStockValuation } from './stock-valuation';

function product(overrides: Partial<Product> & Pick<Product, 'id' | 'name'>): Product {
  return {
    code: '', rack: '', type: 'single', category: '', brand: '', model: '',
    stock: 0, unit: 'pcs', salesPrice: 0, purchasePrice: 0, wholesalePrice: 0,
    ...overrides
  } as Product;
}

describe('productStockValuation', () => {
  it('values a variant product at the weighted prices of its variant stock', () => {
    const bearing = product({
      id: 1, name: 'Bearing', type: 'variant', stock: 100, purchasePrice: 24, salesPrice: 40,
      variants: [
        { id: 11, variationId: 1, variationName: 'Size', variantValue: '6202', itemCode: '', purchasePrice: 10, wholesalePrice: 0, salesPrice: 20, openingStock: 60 },
        { id: 12, variationId: 1, variationName: 'Size', variantValue: '6205', itemCode: '', purchasePrice: 20, wholesalePrice: 0, salesPrice: 30, openingStock: 40 }
      ]
    } as Product);

    const value = productStockValuation(bearing);
    expect(value.qty).toBe(100);
    expect(value.costPrice).toBe(14);
    expect(value.salesPrice).toBe(24);
    expect(value.cost).toBe(1400);
    expect(value.sales).toBe(2400);
  });

  it('keeps the parent stock quantity even when variant quantities drift', () => {
    const bearing = product({
      id: 2, name: 'Bearing', type: 'variant', stock: 50, purchasePrice: 24, salesPrice: 40,
      variants: [
        { id: 21, variationId: 1, variationName: 'Size', variantValue: '6202', itemCode: '', purchasePrice: 10, wholesalePrice: 0, salesPrice: 20, openingStock: 30 },
        { id: 22, variationId: 1, variationName: 'Size', variantValue: '6205', itemCode: '', purchasePrice: 20, wholesalePrice: 0, salesPrice: 30, openingStock: 20 }
      ]
    } as Product);

    const value = productStockValuation(bearing);
    expect(value.qty).toBe(50);
    expect(value.costPrice).toBe(14);
    expect(value.cost).toBe(700);
  });

  it('uses the base prices for a plain product', () => {
    const plain = product({ id: 3, name: 'Motor', stock: 8, purchasePrice: 1500, salesPrice: 1800 });

    expect(productStockValuation(plain)).toEqual({
      qty: 8, costPrice: 1500, salesPrice: 1800, cost: 12000, sales: 14400
    });
  });

  it('falls back to the base prices when no variant holds stock', () => {
    const bearing = product({
      id: 4, name: 'Bearing', type: 'variant', stock: 5, purchasePrice: 24, salesPrice: 40,
      variants: [
        { id: 41, variationId: 1, variationName: 'Size', variantValue: '6202', itemCode: '', purchasePrice: 31, wholesalePrice: 0, salesPrice: 45, openingStock: 0 }
      ]
    } as Product);

    expect(productStockValuation(bearing)).toMatchObject({ costPrice: 24, salesPrice: 40, cost: 120, sales: 200 });
  });
});
