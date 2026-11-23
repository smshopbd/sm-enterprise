import type { Product } from '../services/data';

export interface StockValuation {
  qty: number;
  /** Weighted purchase/sales price per base unit (variant mix for variant products). */
  costPrice: number;
  salesPrice: number;
  cost: number;
  sales: number;
}

/**
 * A variant product carries one parent stock but per-variant prices, so pricing
 * that stock at the parent's base price badly undervalues a bearing shelf. The
 * variants' own stock shares are used to weight their prices; the parent stock
 * stays the quantity, keeping this in sync with the stock page.
 */
export function productStockValuation(product: Product): StockValuation {
  const qty = Number(product.stock) || 0;
  const baseCost = Number(product.purchasePrice) || 0;
  const baseSales = Number(product.salesPrice) || 0;

  const variants = (product.variants ?? [])
    .map(variant => ({ variant, stock: Number(variant.openingStock) || 0 }))
    .filter(entry => entry.stock > 0);

  if (product.type === 'variant' && variants.length) {
    let variantStock = 0;
    let costSum = 0;
    let salesSum = 0;
    for (const { variant, stock } of variants) {
      variantStock += stock;
      costSum += stock * (Number(variant.purchasePrice) || 0);
      salesSum += stock * (Number(variant.salesPrice) || 0);
    }
    if (variantStock > 0) {
      const costPrice = costSum / variantStock;
      const salesPrice = salesSum / variantStock;
      return { qty, costPrice, salesPrice, cost: qty * costPrice, sales: qty * salesPrice };
    }
  }

  return { qty, costPrice: baseCost, salesPrice: baseSales, cost: qty * baseCost, sales: qty * baseSales };
}
