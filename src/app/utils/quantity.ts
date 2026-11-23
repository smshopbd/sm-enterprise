import { Pipe, PipeTransform } from '@angular/core';
import { formatNumber } from '@angular/common';

/**
 * Battery quantities are read as whole pieces or weighed kilos:
 * pcs never carries decimals, kg always shows exactly one (00.0).
 */
export function formatQty(value: number | string | null | undefined, unit: 'kg' | 'pcs' | string = 'kg'): string {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  return unit === 'pcs'
    ? formatNumber(Math.round(safe), 'en-US', '1.0-0')
    : formatNumber(safe, 'en-US', '1.1-1');
}

/** Rounds a typed quantity so pcs stay whole and kg keep one decimal. */
export function roundQty(value: number | string | null | undefined, unit: 'kg' | 'pcs' | string = 'kg'): number {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  return unit === 'pcs' ? Math.round(safe) : Math.round(safe * 10) / 10;
}

/** Input boxes echo the normalized figure on blur: whole pieces, or kilos with one decimal. */
export function formatQtyInput(value: number | string | null | undefined, unit: 'kg' | 'pcs' | string = 'kg'): string {
  const qty = roundQty(value, unit);
  return unit === 'pcs' ? String(qty) : qty.toFixed(1);
}

@Pipe({ name: 'qty' })
export class QtyPipe implements PipeTransform {
  transform(value: number | string | null | undefined, unit: 'kg' | 'pcs' | string = 'kg'): string {
    return formatQty(value, unit);
  }
}
