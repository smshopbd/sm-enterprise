import { describe, expect, it } from 'vitest';
import { Product } from '../services/data';
import { saleItemDisplayName } from './sale-item-label';

const products: Product[] = [
  {
    id: 1, name: 'Battery', code: 'B1', rack: 'R1', type: 'variant', category: 'Power', brand: 'Volt', model: 'V1',
    stock: 0, unit: 'pcs', salesPrice: 100, purchasePrice: 80, wholesalePrice: 90,
    variants: [
      { id: 11, variationId: 1, variationName: 'Size', variantValue: 'A', itemCode: 'B1-A', purchasePrice: 80, wholesalePrice: 90, salesPrice: 100, openingStock: 5 },
      { id: 12, variationId: 1, variationName: 'Size', variantValue: 'B', itemCode: 'B1-B', purchasePrice: 80, wholesalePrice: 90, salesPrice: 110, openingStock: 5 }
    ]
  }
];

describe('saleItemDisplayName', () => {
  it('leaves plain lines untouched', () => {
    expect(saleItemDisplayName({ productName: 'Battery', productId: 1 }, products)).toBe('Battery');
  });

  it('appends the variant value for POS lines saved without it', () => {
    expect(saleItemDisplayName({ productName: 'Battery', productId: 1, variantId: 11 }, products)).toBe('Battery - A');
  });

  it('does not repeat a variant already stored in the name', () => {
    expect(saleItemDisplayName({ productName: 'Battery - A', productId: 1, variantId: 11 }, products)).toBe('Battery - A');
  });

  it('falls back to a catalog-wide variant lookup when productId is missing', () => {
    expect(saleItemDisplayName({ productName: 'Battery', variantId: 12 }, products)).toBe('Battery - B');
  });

  it('keeps the stored name when the variant no longer exists', () => {
    expect(saleItemDisplayName({ productName: 'Battery', productId: 1, variantId: 99 }, products)).toBe('Battery');
  });
});
