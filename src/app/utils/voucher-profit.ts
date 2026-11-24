import type { Product, Sale, SalesReturn } from '../services/data';
import { returnedItemsOf, soldItemsOf } from './report-analytics';

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export interface VoucherProfitLine {
  name: string;
  /** Quantity as typed on the voucher, in `unit`. */
  quantity: number;
  unit: string;
  /** Quantity in the product's base unit; negative on a credit note. */
  baseQty: number;
  /** Line value after its share of the order/note discount. */
  revenue: number;
  cost: number;
  profit: number;
  /** False when the product or its purchase price cannot be found. */
  costKnown: boolean;
  returned: boolean;
}

export interface VoucherProfit {
  id: number;
  invoice: string;
  date: string;
  customer: string;
  lineCount: number;
  qty: number;
  /** The invoice total exactly as the customer paid it. */
  revenue: number;
  /** Posted credit notes against this invoice, matched by invoice number. */
  returns: number;
  netRevenue: number;
  cost: number;
  profit: number;
  margin: number;
  costIncomplete: boolean;
  /** Net revenue minus the sum of line values (shipping, tax, old-battery credit…). */
  adjustment: number;
  lines: VoucherProfitLine[];
  returnLines: VoucherProfitLine[];
}

export interface VoucherProfitTotals {
  count: number;
  complete: number;
  incomplete: number;
  revenue: number;
  returns: number;
  cost: number;
  profit: number;
  /** Complete vouchers whose profit is below zero. */
  loss: number;
}

function lineOf(
  item: ReturnType<typeof soldItemsOf>[number],
  returned: boolean,
  costKnown: boolean
): VoucherProfitLine {
  const cost = round2(item.baseQty * item.unitCost);
  return {
    name: item.item.productName,
    quantity: Number(item.item.quantity) || 0,
    unit: item.item.unit || '',
    baseQty: item.baseQty,
    revenue: item.netRevenue,
    cost,
    profit: round2(item.netRevenue - cost),
    costKnown,
    returned
  };
}

/**
 * Profit per sale voucher, built on the same line costing as the Reports page
 * so a voucher can never disagree with the period totals. Credit notes are
 * matched by invoice number regardless of the note's own date: a return belongs
 * to the voucher it reverses. A line without a known purchase price marks the
 * voucher incomplete instead of pretending the whole sale is profit.
 */
export function saleVoucherProfits(
  sales: Sale[],
  returns: SalesReturn[],
  products: Product[]
): VoucherProfit[] {
  const invoiceKey = (invoice: string) => (invoice || '').trim().toLowerCase();
  const notesByInvoice = new Map<string, SalesReturn[]>();
  for (const note of returns) {
    if (note.status !== 'Posted') continue;
    const key = invoiceKey(note.invoiceNumber);
    if (!key) continue;
    const list = notesByInvoice.get(key);
    if (list) list.push(note);
    else notesByInvoice.set(key, [note]);
  }

  return sales
    .filter(sale => sale.status !== 'Cancelled')
    .map(sale => {
      const lines = soldItemsOf(sale, products)
        .map(item => lineOf(item, false, !!item.product && item.unitCost > 0));
      const notes = notesByInvoice.get(invoiceKey(sale.invoice)) ?? [];
      const returnLines: VoucherProfitLine[] = [];
      for (const note of notes) {
        for (const item of returnedItemsOf(note, products)) {
          // A damaged return is not restocked, so it deliberately carries no cost.
          const costKnown = !note.restock || (!!item.product && item.unitCost > 0);
          returnLines.push(lineOf(item, true, costKnown));
        }
      }

      const revenue = round2(Number(sale.total) || 0);
      const returnedAmount = round2(notes.reduce((sum, note) => sum + (Number(note.amount) || 0), 0));
      const netRevenue = round2(revenue - returnedAmount);
      const all = [...lines, ...returnLines];
      const cost = round2(all.reduce((sum, line) => sum + line.cost, 0));
      const lineRevenue = round2(all.reduce((sum, line) => sum + line.revenue, 0));
      const profit = round2(netRevenue - cost);

      return {
        id: sale.id,
        invoice: sale.invoice,
        date: sale.date,
        customer: sale.customerName || 'Walk-in',
        lineCount: lines.length,
        qty: round2(lines.reduce((sum, line) => sum + line.baseQty, 0)),
        revenue,
        returns: returnedAmount,
        netRevenue,
        cost,
        profit,
        margin: netRevenue > 0 ? Math.round((profit / netRevenue) * 1000) / 10 : 0,
        costIncomplete: all.some(line => !line.costKnown),
        adjustment: round2(netRevenue - lineRevenue),
        lines,
        returnLines
      };
    });
}

/** Money totals over complete vouchers only; incomplete ones would fake profit. */
export function voucherProfitTotals(rows: VoucherProfit[]): VoucherProfitTotals {
  const complete = rows.filter(row => !row.costIncomplete);
  return {
    count: rows.length,
    complete: complete.length,
    incomplete: rows.length - complete.length,
    revenue: round2(complete.reduce((sum, row) => sum + row.netRevenue, 0)),
    returns: round2(complete.reduce((sum, row) => sum + row.returns, 0)),
    cost: round2(complete.reduce((sum, row) => sum + row.cost, 0)),
    profit: round2(complete.reduce((sum, row) => sum + row.profit, 0)),
    loss: complete.filter(row => row.profit < 0).length
  };
}
