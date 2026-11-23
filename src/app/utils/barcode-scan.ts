import { Product, ProductVariant } from '../services/data';

export interface ScanMatch {
  product: Product;
  variant?: ProductVariant;
}

/** Scanners may append a newline or invisible GS1 separators; drop them. */
export function normalizeScanValue(raw: string | number | null | undefined): string {
  const text = Array.from(String(raw ?? ''))
    .filter(char => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
  return text.trim().toLowerCase();
}

function compactScanValue(raw: string): string {
  return normalizeScanValue(raw).replace(/[\s\-_.]/g, '');
}

function digitsOf(raw: string): string {
  return normalizeScanValue(raw).replace(/\D/g, '');
}

/**
 * Strict barcode lookup shared by the POS, sales form and label printer tests:
 * exact code first, then a separator-insensitive pass, then a digits-only pass
 * so a UPC-A read as EAN-13 (one extra leading zero) still finds its product.
 */
export function findScanMatch(products: Product[], raw: string): ScanMatch | null {
  const key = normalizeScanValue(raw);
  if (!key) return null;

  const findVariant = (same: (value: string) => boolean): ScanMatch | null => {
    for (const product of products) {
      const variant = (product.variants || []).find(candidate =>
        same(String(candidate.itemCode ?? '')) ||
        same(`${product.name} - ${candidate.variantValue}`));
      if (variant) return { product, variant };
    }
    return null;
  };
  const findProduct = (same: (value: string) => boolean): ScanMatch | null => {
    const product = products.find(candidate => same(String(candidate.code ?? '')) || same(candidate.name));
    return product ? { product } : null;
  };

  const exact = (value: string) => normalizeScanValue(value) === key;
  let hit = findVariant(exact) ?? findProduct(exact);
  if (hit) return hit;

  const compact = compactScanValue(raw);
  if (compact) {
    const near = (value: string) => compactScanValue(value) === compact;
    hit = findVariant(near) ?? findProduct(near);
    if (hit) return hit;
  }

  const digits = digitsOf(raw);
  if (digits.length >= 8) {
    const bare = digits.replace(/^0+/, '');
    const sameDigits = (value: string) => {
      const candidate = digitsOf(value);
      return candidate.length >= 8 && candidate.replace(/^0+/, '') === bare;
    };
    hit = findVariant(sameDigits) ?? findProduct(sameDigits);
    if (hit) return hit;
  }

  return null;
}
