import { Product } from '../services/data';
import { findScanMatch, normalizeScanValue } from './barcode-scan';
import { encodeBarcode, normalizeSymbology } from './barcode-render';

const phone: Product = {
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
    openingStock: 5,
  }],
};

const cable: Product = {
  ...phone,
  id: 2,
  name: 'USB Cable',
  code: '8901234567897',
  type: 'single',
  variants: [],
};

const upc: Product = {
  ...phone,
  id: 3,
  name: 'Power Bank',
  code: '036000291452',
  type: 'single',
  variants: [],
};

describe('scan matching', () => {
  it('normalises scanner noise before comparing', () => {
    expect(normalizeScanValue('  S23-256\n')).toBe('s23-256');
  });

  it('finds a variant by item code and a parent by product code', () => {
    expect(findScanMatch([phone], 's23-256')?.variant?.id).toBe(10);
    expect(findScanMatch([phone], ' PHONE-23 ')?.product.id).toBe(1);
  });

  it('ignores separators inside codes', () => {
    expect(findScanMatch([phone], 'phone 23')?.product.id).toBe(1);
    expect(findScanMatch([phone], 'phone.23')?.product.id).toBe(1);
  });

  it('matches a UPC-A code read through an EAN-13 scanner with a leading zero', () => {
    expect(findScanMatch([upc], '0036000291452')?.product.id).toBe(3);
  });

  it('does not fuzzy-match unrelated text', () => {
    expect(findScanMatch([phone, cable], 'samsung galaxy')).toBeNull();
    expect(findScanMatch([phone], '')).toBeNull();
  });
});

describe('barcode encoding', () => {
  it('maps product symbology names', () => {
    expect(normalizeSymbology('code 128')).toBe('CODE128');
    expect(normalizeSymbology('code-39')).toBe('CODE39');
    expect(normalizeSymbology('EAN-13')).toBe('EAN13');
    expect(normalizeSymbology('EAN 8')).toBe('EAN8');
    expect(normalizeSymbology('UPC-A')).toBe('UPCA');
    expect(normalizeSymbology(undefined)).toBe('CODE128');
  });

  it('recomputes GTIN check digits', () => {
    expect(encodeBarcode('4006381333931', 'EAN13')).toEqual({ format: 'EAN13', value: '4006381333931' });
    expect(encodeBarcode('96385074', 'EAN8')).toEqual({ format: 'EAN8', value: '96385074' });
    expect(encodeBarcode('036000291452', 'UPCA')).toEqual({ format: 'UPCA', value: '036000291452' });
  });

  it('falls back to CODE 128 when the code does not fit the symbology', () => {
    expect(encodeBarcode('PHONE-23', 'EAN13')).toEqual({ format: 'CODE128', value: 'PHONE-23' });
    expect(encodeBarcode('AB-12', 'CODE39')).toEqual({ format: 'CODE39', value: 'AB-12' });
    // CODE 39 is uppercase-only, so lowercase codes print as CODE 128 unchanged.
    expect(encodeBarcode('ab-12', 'CODE39')).toEqual({ format: 'CODE39', value: 'AB-12' });
    expect(encodeBarcode('ab_12', 'CODE39')).toEqual({ format: 'CODE128', value: 'ab_12' });
  });
});
