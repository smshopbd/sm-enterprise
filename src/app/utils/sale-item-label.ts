import { Product, ProductVariant, SaleItem } from '../services/data';

type SaleItemNameSource = Pick<SaleItem, 'productName' | 'productId' | 'variantId'>;

/**
 * POS lines saved before 2026-11-22 keep only `variantId` in the sale item,
 * so the variant value is resolved from the catalog while rendering vouchers.
 */
export function saleItemDisplayName(item: SaleItemNameSource, products: readonly Product[]): string {
  const name = (item.productName || '').trim();
  if (item.variantId == null) return name;
  const variant = findVariant(item, products);
  const value = (variant?.variantValue || variant?.variationName || '').trim();
  if (!value) return name;
  const lowerName = name.toLowerCase();
  const lowerValue = value.toLowerCase();
  if (lowerName.endsWith(`- ${lowerValue}`) || lowerName.endsWith(`· ${lowerValue}`)) return name;
  return `${name} - ${value}`;
}

function findVariant(item: SaleItemNameSource, products: readonly Product[]): ProductVariant | undefined {
  const product = item.productId != null ? products.find(p => p.id === item.productId) : undefined;
  const direct = product?.variants?.find(v => v.id === item.variantId);
  if (direct) return direct;
  for (const p of products) {
    const hit = p.variants?.find(v => v.id === item.variantId);
    if (hit) return hit;
  }
  return undefined;
}
