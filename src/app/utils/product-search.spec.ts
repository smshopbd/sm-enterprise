import { Product } from '../services/data';
import { matchedVariants, matchesParentFields, matchesProductSearch, matchesVariantText, searchProductEntries, searchProducts } from './product-search';

const samsung: Product = {
  id: 1,
  name: 'Samsung Galaxy S23',
  code: 'PHONE-23',
  rack: 'A-1',
  type: 'variant',
  category: 'Mobile',
  subCategory: 'Smartphone',
  brand: 'Samsung',
  model: 'Galaxy S23',
  stock: 5,
  unit: 'piece',
  salesPrice: 50000,
  purchasePrice: 45000,
  wholesalePrice: 48000,
  variants: [{
    id: 10,
    variationId: 2,
    variationName: 'Storage',
    variantValue: '256 GB',
    itemCode: 'S23-256',
    purchasePrice: 45000,
    wholesalePrice: 48000,
    salesPrice: 50000,
    openingStock: 5
  }]
};

const anotherProduct: Product = {
  ...samsung,
  id: 2,
  name: 'Samsung Galaxy A14',
  code: 'PHONE-14',
  model: 'Galaxy A14',
  variants: []
};

describe('product search', () => {
  it.each([undefined, null, 123])('searches the full catalog when an imported rack is %s', rack => {
    const imported = { ...anotherProduct, rack } as unknown as Product;
    expect(searchProducts([imported, samsung], 's23')).toEqual([samsung]);
    expect(searchProductEntries([imported, samsung], 's23').map(hit => hit.product)).toEqual([samsung]);
    expect(searchProducts([imported, samsung], 'samsung a14')).toEqual([imported]);
    expect(matchesProductSearch(imported, 'PHONE-14')).toBe(true);
    expect(matchesParentFields(imported, 'PHONE-14')).toBe(true);
  });

  it('searches old records with missing catalog fields and numeric codes without changing them', () => {
    const imported = {
      id: 3, name: 'Legacy Motor', code: 987654, type: 'single',
      category: null, brand: null, model: 42, stock: 4, salesPrice: 900
    } as unknown as Product;
    const before = JSON.stringify(imported);
    expect(searchProducts([imported], '৯৮৭৬৫৪')).toEqual([imported]);
    expect(searchProductEntries([imported], 'motor 42')).toHaveLength(1);
    expect(searchProductEntries([imported], 'unavailable')).toEqual([]);
    expect(JSON.stringify(imported)).toBe(before);
  });

  it('matches imported variants with numeric codes and missing labels', () => {
    const variant = { ...samsung.variants![0], itemCode: 98765, variationName: null, variantValue: undefined } as unknown as NonNullable<Product['variants']>[number];
    const imported = { ...samsung, variants: [variant] };
    expect(searchProducts([imported], '৯৮৭৬৫')).toEqual([imported]);
    expect(searchProductEntries([imported], '98765')[0].variant).toBe(variant);
    expect(matchedVariants(imported, '98765')).toEqual([variant]);
    expect(matchesVariantText(variant, '98765')).toBe(true);
  });

  it('preserves variant price matching and empty-query behavior', () => {
    expect(searchProductEntries([samsung], '৫০,০০০')[0].variant).toBe(samsung.variants![0]);
    expect(searchProductEntries([samsung], '49,999')).toEqual([]);
    expect(searchProducts([samsung], '   ')).toEqual([]);
    expect(searchProductEntries([samsung], '')).toEqual([]);
    expect(matchesProductSearch(samsung, '')).toBe(true);
  });

  it('matches multiple terms across product and variant fields despite a small typo', () => {
    expect(searchProducts([anotherProduct, samsung], 'samsng 23 256')).toEqual([samsung]);
    expect(matchedVariants(samsung, 'samsng 23 256')).toHaveLength(1);
  });

  it('normalizes barcode punctuation and Bengali digits', () => {
    expect(searchProducts([samsung], 'phone ২৩')).toEqual([samsung]);
  });

  it('sorts exact product matches before broader partial matches', () => {
    const broader = { ...samsung, code: 'PHONE-23-X' };
    const exact = { ...samsung, id: 3, code: 'PHONE-23' };
    expect(searchProducts([broader, exact], 'PHONE-23')[0]).toBe(exact);
  });
});
