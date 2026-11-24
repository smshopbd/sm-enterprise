import type { Product } from '../services/data';

export interface UnitChoice {
  name: string;
  /** Base units per one of this unit. */
  factor: number;
  price: number;
  wholesalePrice: number;
  isBase: boolean;
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

type UnitProduct = Pick<Product, 'unit' | 'salesPrice' | 'wholesalePrice' | 'units'>;

/**
 * Selling units for a product: the base unit first, then every configured extra
 * unit with its price (explicit, or derived from the base price × factor).
 * A unit with factor 1 shares the stock count one-for-one (গজ/কেজি/পিস).
 */
export function productUnitChoices(product: UnitProduct | null | undefined): UnitChoice[] {
  if (!product) return [];
  const baseName = (product.unit || '').trim() || 'pcs';
  const basePrice = Number(product.salesPrice) || 0;
  const baseWholesale = Number(product.wholesalePrice) || 0;
  const choices: UnitChoice[] = [{
    name: baseName,
    factor: 1,
    price: round2(basePrice),
    wholesalePrice: round2(baseWholesale),
    isBase: true
  }];
  // The shop's wholesale/retail ratio carries over to units priced by hand,
  // so a ৩৬০০ TK বস্তা never wholesales above its own retail price.
  const wholesaleRatio = basePrice > 0 && baseWholesale > 0 ? baseWholesale / basePrice : 1;
  for (const unit of product.units ?? []) {
    const name = (unit.name || '').trim();
    const factor = Number(unit.factor);
    if (!name || !(factor > 0)) continue;
    if (choices.some(c => c.name.toLowerCase() === name.toLowerCase())) continue;
    const explicit = Number(unit.price);
    const price = explicit > 0 ? round2(explicit) : round2(basePrice * factor);
    choices.push({
      name,
      factor,
      price,
      wholesalePrice: round2(price * wholesaleRatio),
      isBase: false
    });
  }
  return choices;
}

export function hasExtraUnits(product: UnitProduct | null | undefined): boolean {
  return productUnitChoices(product).length > 1;
}

export function unitChoiceOf(product: UnitProduct | null | undefined, unitName: string | null | undefined): UnitChoice {
  const choices = productUnitChoices(product);
  const target = (unitName || '').trim().toLowerCase();
  return choices.find(c => c.name.toLowerCase() === target)
    ?? choices[0]
    ?? { name: 'pcs', factor: 1, price: 0, wholesalePrice: 0, isBase: true };
}

/** Base units per the chosen unit; unknown/blank units behave as the base unit. */
export function unitFactorOf(product: UnitProduct | null | undefined, unitName: string | null | undefined): number {
  return unitChoiceOf(product, unitName).factor;
}

export function unitPriceOf(product: UnitProduct | null | undefined, unitName: string | null | undefined, wholesale = false): number {
  const choice = unitChoiceOf(product, unitName);
  if (!wholesale) return choice.price;
  return choice.wholesalePrice > 0 ? choice.wholesalePrice : choice.price;
}

/** Stock movement of a sale/return line, always in the product's base unit. */
export function saleLineBaseQty(item: { quantity?: number; unitFactor?: number } | null | undefined): number {
  const quantity = Number(item?.quantity) || 0;
  const factor = Number(item?.unitFactor);
  return round2(quantity * (factor > 0 ? factor : 1));
}
