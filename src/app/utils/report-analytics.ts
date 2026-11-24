import type { Product, ProductVariant, Sale, SalesReturn } from '../services/data';
import { saleLineBaseQty } from './product-units';

/** What the profit math needs from a sale line or a credit-note line. */
export interface SoldLine {
  productId?: number;
  variantId?: number;
  productName: string;
  quantity?: number;
  unit?: string;
  unitFactor?: number;
}

export interface SoldItem {
  invoice: string;
  date: string;
  item: SoldLine;
  product?: Product;
  variant?: ProductVariant;
  /** Quantity in the product's base unit; negative on a return. */
  baseQty: number;
  /** Purchase price per base unit: the variant's own cost when it has one. */
  unitCost: number;
  /** Line total minus its share of the order-level discount; negative on a return. */
  netRevenue: number;
}

export interface ProductProfitRow {
  key: string;
  name: string;
  category: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  costKnown: boolean;
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export function normalizeProductName(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]/g, '');
}

/**
 * The product id saved on the sale line is authoritative; the name is only a
 * fallback for legacy rows. Prefix-style name guessing used to attach a renamed
 * or variant line to whichever product shared its first ten characters.
 */
export function findProductForLine(
  products: Product[],
  line: { productId?: number; productName: string }
): Product | undefined {
  if (line.productId != null) {
    const byId = products.find(p => p.id === line.productId);
    if (byId) return byId;
  }
  const target = normalizeProductName(line.productName);
  if (!target) return undefined;
  return products.find(p => normalizeProductName(p.name) === target);
}

/**
 * Older variant lines were saved without a variant id, but their name carries
 * the variant value after a dash ("Bearing F & D - 6202"). Match that suffix,
 * never the bare product name.
 */
export function findVariantForLine(
  product: Product | undefined,
  line: { variantId?: number; productName: string }
): ProductVariant | undefined {
  if (!product?.variants?.length) return undefined;
  if (line.variantId != null) {
    const direct = product.variants.find(v => v.id === line.variantId);
    if (direct) return direct;
  }
  const name = normalizeProductName(line.productName);
  if (!name || name === normalizeProductName(product.name)) return undefined;
  let best: ProductVariant | undefined;
  let bestLength = 0;
  for (const variant of product.variants) {
    const key = normalizeProductName(variant.variantValue);
    if (key.length > bestLength && name.endsWith(key)) {
      best = variant;
      bestLength = key.length;
    }
  }
  return best;
}

export function lineUnitCost(product: Product | undefined, variant: ProductVariant | undefined): number {
  if (!product) return 0;
  if (variant) {
    const variantPrice = Number(variant.purchasePrice) || 0;
    if (variantPrice > 0) return variantPrice;
  }
  return Number(product.purchasePrice) || 0;
}

/**
 * The voucher's order discount is stored as typed (taka, or a percentage of the
 * item total), so it has to be turned into money before it can be shared.
 */
export function orderDiscountAmount(
  sale: Pick<Sale, 'orderDiscount' | 'orderDiscountType'>,
  itemsTotal: number
): number {
  const value = Number(sale.orderDiscount) || 0;
  if (value <= 0 || itemsTotal <= 0) return 0;
  const raw = sale.orderDiscountType === 'percent' ? (itemsTotal * value) / 100 : value;
  return round2(Math.min(itemsTotal, Math.max(0, raw)));
}

export function soldItemsOf(sale: Sale, products: Product[]): SoldItem[] {
  const items = sale.items ?? [];
  const itemsTotal = round2(items.reduce((sum, item) => sum + (Number(item.total) || 0), 0));
  const orderDiscount = orderDiscountAmount(sale, itemsTotal);

  return items.map(item => {
    const product = findProductForLine(products, item);
    const variant = findVariantForLine(product, item);
    const lineTotal = Number(item.total) || 0;
    const netRevenue = itemsTotal > 0
      ? round2(lineTotal - (lineTotal / itemsTotal) * orderDiscount)
      : lineTotal;
    return {
      invoice: sale.invoice,
      date: sale.date,
      item,
      product,
      variant,
      baseQty: saleLineBaseQty(item),
      unitCost: lineUnitCost(product, variant),
      netRevenue
    };
  });
}

/** The note-level discount as money, shared over the returned lines. */
export function noteDiscountAmount(
  note: Pick<SalesReturn, 'discount' | 'discountType'>,
  itemsTotal: number
): number {
  const value = Number(note.discount) || 0;
  if (value <= 0 || itemsTotal <= 0) return 0;
  const raw = note.discountType === 'percent' ? (itemsTotal * value) / 100 : value;
  return round2(Math.min(itemsTotal, Math.max(0, raw)));
}

/**
 * A credit note reverses the sale: negative quantity and revenue. Its cost comes
 * back only when the goods were restocked; a damaged return keeps its cost, so
 * the difference shows up as loss instead of silently vanishing.
 */
export function returnedItemsOf(note: SalesReturn, products: Product[]): SoldItem[] {
  const items = note.items ?? [];
  const itemsTotal = round2(items.reduce((sum, item) => sum + (Number(item.total) || 0), 0));
  const discount = noteDiscountAmount(note, itemsTotal);

  return items.map(item => {
    const product = findProductForLine(products, item);
    const variant = findVariantForLine(product, item);
    const lineTotal = Number(item.total) || 0;
    const netRevenue = itemsTotal > 0
      ? round2(lineTotal - (lineTotal / itemsTotal) * discount)
      : lineTotal;
    return {
      invoice: note.creditNoteNo,
      date: note.date,
      item,
      product,
      variant,
      baseQty: round2(-saleLineBaseQty(item)),
      unitCost: note.restock ? lineUnitCost(product, variant) : 0,
      netRevenue: round2(-netRevenue)
    };
  });
}

export function productProfitRows(items: SoldItem[]): ProductProfitRow[] {
  const map = new Map<string, ProductProfitRow>();
  for (const row of items) {
    const { item, product, variant } = row;
    const key = product
      ? `${product.id}:${variant?.id ?? 0}`
      : `name:${normalizeProductName(item.productName) || item.productName}`;
    const name = product
      ? (variant ? `${product.name} - ${variant.variantValue}` : product.name)
      : (item.productName || '').trim() || '—';
    const existing = map.get(key);
    if (existing) {
      existing.qty = round2(existing.qty + row.baseQty);
      existing.revenue = round2(existing.revenue + row.netRevenue);
      existing.cost = round2(existing.cost + row.unitCost * row.baseQty);
      existing.costKnown = existing.costKnown || !!product;
    } else {
      map.set(key, {
        key,
        name,
        category: (product?.category || '').trim() || 'অন্যান্য',
        qty: row.baseQty,
        revenue: row.netRevenue,
        cost: round2(row.unitCost * row.baseQty),
        profit: 0,
        margin: 0,
        costKnown: !!product
      });
    }
  }

  return [...map.values()]
    .map(row => {
      const profit = round2(row.revenue - row.cost);
      return { ...row, profit, margin: row.revenue ? (profit / row.revenue) * 100 : 0 };
    })
    .sort((a, b) => b.profit - a.profit);
}

export function categoryProfitRows(rows: ProductProfitRow[]): ProductProfitRow[] {
  const map = new Map<string, ProductProfitRow>();
  for (const row of rows) {
    const existing = map.get(row.category);
    if (existing) {
      existing.qty = round2(existing.qty + row.qty);
      existing.revenue = round2(existing.revenue + row.revenue);
      existing.cost = round2(existing.cost + row.cost);
      existing.costKnown = existing.costKnown || row.costKnown;
    } else {
      map.set(row.category, { ...row, key: row.category, name: row.category, profit: 0, margin: 0 });
    }
  }
  return [...map.values()]
    .map(row => {
      const profit = round2(row.revenue - row.cost);
      return { ...row, profit, margin: row.revenue ? (profit / row.revenue) * 100 : 0 };
    })
    .sort((a, b) => b.profit - a.profit);
}
