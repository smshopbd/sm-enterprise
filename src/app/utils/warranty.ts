import type { Product, ProductWarranty, Purchase, Sale, WarrantyClaimInfo, WarrantyReceipt, WarrantyReplacement } from '../services/data';
import { localDateIso } from './local-date';

/**
 * Claim statuses are stored untranslated (they are data, not labels), so every
 * screen must compare against these constants instead of the visible text.
 */
export const WARRANTY_STATUS_IN_PROGRESS = 'প্রক্রিয়াধীন';
export const WARRANTY_STATUS_COMPLETED = 'পরিবর্তন সম্পন্ন';
export const WARRANTY_STATUS_CANCELLED = 'বাতিল';

export function isWarrantyCompleted(status: string | null | undefined): boolean {
  const s = (status || '').trim().toLowerCase();
  return s === WARRANTY_STATUS_COMPLETED || s === 'completed' || s === 'replaced';
}

export function isWarrantyCancelled(status: string | null | undefined): boolean {
  const s = (status || '').trim().toLowerCase();
  return s === WARRANTY_STATUS_CANCELLED || s === 'cancelled' || s === 'canceled';
}

/**
 * Vouchers store dates in more than one shape: sales as `YYYY-MM-DD`, purchases
 * as `DD-MM-YYYY`. Normalise both to the ISO day so date maths always works.
 */
export function isoDay(value: string | null | undefined): string {
  const v = (value || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

export function addDaysIso(startIso: string, days: number): string {
  const start = Date.parse(`${isoDay(startIso)}T00:00:00Z`);
  if (Number.isNaN(start) || !Number.isFinite(days)) return '';
  const d = new Date(start + Math.round(days) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Whole days from `fromIso` to `toIso`; negative when `toIso` is earlier. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${isoDay(fromIso)}T00:00:00Z`);
  const to = Date.parse(`${isoDay(toIso)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}

export function warrantyExpiryDate(startIso: string, warrantyDays: number): string {
  const days = Math.max(0, Math.round(Number(warrantyDays) || 0));
  if (!days) return '';
  return addDaysIso(startIso, days);
}

/** Calendar-month expiry: 2 months from 10 Nov is 10 Jan, not a fixed 60 days. */
export function addMonthsIso(startIso: string, months: number): string {
  const day = isoDay(startIso);
  const count = Math.round(Number(months) || 0);
  if (!day || count <= 0) return '';
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(target.getUTCDate()).padStart(2, '0')}`;
}

/** Days left (negative when expired); 0 when either side is unknown. */
export function warrantyRemainingDays(startIso: string, warrantyDays: number, todayIso: string = localDateIso()): number {
  const days = Math.max(0, Math.round(Number(warrantyDays) || 0));
  if (!days || !isoDay(startIso)) return 0;
  return Math.round(days - daysBetweenIso(startIso, todayIso));
}

/** Warranty period in days from whatever the old record kept (legacy stored remaining days). */
export function warrantyDaysOfRecord(record: Pick<ProductWarranty, 'warrantyDays' | 'remainingDays'>): number {
  return Math.max(0, Math.round(Number(record.warrantyDays ?? record.remainingDays) || 0));
}

export function parseWarrantyQuantity(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : parseFloat((value || '').toString());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ---------------- Register rows ----------------

export type WarrantyRowState = 'Active' | 'Claimed' | 'Replaced' | 'Cancelled' | 'Expired';

export interface WarrantyRowClaim {
  claimNo: string;
  originalInvoice: string;
  battery: string;
  quantity: number;
  receiveDate: string;
  receiptNo: string;
  oldSerial: string;
  replacementDate: string;
  deliveryNo: string;
  newSerial: string;
  status: string;
  replacementProductName?: string;
  replacementQty?: number;
}

export interface WarrantyRegisterRow {
  /** Stable identity: `sale-<saleId>-<itemId>`, `claim-<saleId>`, `receipt-<id>` or `manual-<id>`. */
  key: string;
  source: 'sale' | 'purchase' | 'manual' | 'receipt';
  manualId?: number;
  saleId?: number;
  purchaseId?: number;
  receiptId?: number;
  type: 'Selling' | 'Purchase';
  state: WarrantyRowState;
  customerName: string;
  phoneNumber: string;
  productName: string;
  serialNumber: string;
  invoiceNumber: string;
  /** ISO day the warranty started (sale/purchase date). */
  date: string;
  quantity: number;
  unit: string;
  warrantyDays: number;
  /** Period given on the sale line in months, when the shop chose one. */
  warrantyMonths?: number;
  expiryDate: string;
  remainingDays: number;
  claim?: WarrantyRowClaim;
  notes?: string;
}

export interface WarrantyRegisterInput {
  sales: Sale[];
  purchases: Purchase[];
  products: Product[];
  manual: ProductWarranty[];
  /** Intake documents (including the ones Add Sale creates) are claim sources too. */
  receipts?: WarrantyReceipt[];
  /** Replacement vouchers carry the new serial and settle their receipt. */
  replacements?: WarrantyReplacement[];
  phoneOf?: (name: string) => string;
  todayIso?: string;
}

const norm = (value: string | null | undefined) => (value || '').trim().toLowerCase();

function toRowClaim(claim: WarrantyClaimInfo): WarrantyRowClaim {
  return {
    claimNo: claim.claimNo || '',
    originalInvoice: claim.originalInvoice || '',
    battery: claim.battery || '',
    quantity: parseWarrantyQuantity(claim.quantity),
    receiveDate: isoDay(claim.receiveDate) || claim.receiveDate || '',
    receiptNo: claim.receiptNo || '',
    oldSerial: claim.oldSerial || '',
    replacementDate: isoDay(claim.replacementDate) || claim.replacementDate || '',
    deliveryNo: claim.deliveryNo || '',
    newSerial: claim.newSerial || '',
    status: claim.status || '',
    replacementProductName: claim.replacementProductName || '',
    replacementQty: Number(claim.replacementQty) || 0
  };
}

/**
 * Turns an intake document into claim fields, borrowing the details only the
 * sale voucher (receipt no, delivery no) or a replacement voucher (new serial)
 * knows about.
 */
function receiptClaimInfo(
  receipt: WarrantyReceipt,
  saleClaim: WarrantyClaimInfo | undefined,
  replacement: WarrantyReplacement | undefined
): WarrantyClaimInfo {
  const quantity = Number(receipt.quantity) || parseWarrantyQuantity(saleClaim?.quantity) || 1;
  // A completed replacement closes the claim even though the intake row keeps
  // its own (customizable) status label.
  const replaced = !!replacement
    && (replacement.stage ? replacement.stage === 'completed' : isWarrantyCompleted(replacement.status));
  return {
    claimNo: receipt.claimNo || saleClaim?.claimNo || '',
    originalInvoice: receipt.invoiceNumber || saleClaim?.originalInvoice || '',
    battery: receipt.productName || saleClaim?.battery || '',
    quantity: String(quantity),
    receiveDate: isoDay(receipt.date),
    receiptNo: saleClaim?.receiptNo || '',
    oldSerial: receipt.serialNumber || saleClaim?.oldSerial || '',
    replacementDate: isoDay(replacement?.date) || isoDay(receipt.replacedAt) || saleClaim?.replacementDate || '',
    deliveryNo: saleClaim?.deliveryNo || '',
    newSerial: (replacement?.serialNumber || '').trim() || saleClaim?.newSerial || '',
    status: replaced ? WARRANTY_STATUS_COMPLETED : (receipt.status || saleClaim?.status || WARRANTY_STATUS_IN_PROGRESS),
    productId: receipt.productId ?? saleClaim?.productId,
    replacementProductId: replacement?.productId ?? saleClaim?.replacementProductId,
    replacementProductName: replacement?.productName || saleClaim?.replacementProductName,
    replacementQty: Number(replacement?.quantity) || saleClaim?.replacementQty,
    replacementUnit: replacement?.unit || saleClaim?.replacementUnit,
    warrantyDays: Number(receipt.warrantyDays) || saleClaim?.warrantyDays,
    notes: receipt.reason || saleClaim?.notes
  };
}

function claimMatchesEntry(claim: WarrantyClaimInfo, entry: ProductWarranty): boolean {
  const claimSerial = norm(claim.oldSerial);
  const entrySerial = norm(entry.serialNumber);
  if (claimSerial && entrySerial && claimSerial === entrySerial) return true;
  const claimInvoice = norm(claim.originalInvoice);
  const entryInvoice = norm(entry.invoiceNumber);
  return !!claimInvoice && claimInvoice === entryInvoice
    && (!claim.battery || !entry.productName || norm(claim.battery) === norm(entry.productName));
}

/**
 * A single register built from what the shop actually recorded: sold items whose
 * product carries a warranty period, purchased items under supplier warranty, the
 * claim vouchers raised for them, and any legacy manual register entries.
 */
export function buildWarrantyRegister(input: WarrantyRegisterInput): WarrantyRegisterRow[] {
  const today = input.todayIso || localDateIso();
  const phoneOf = input.phoneOf || (() => '');
  const productById = new Map<number, Product>();
  const productByName = new Map<string, Product>();
  for (const product of input.products || []) {
    productById.set(product.id, product);
    const name = norm(product.name);
    if (name && !productByName.has(name)) productByName.set(name, product);
  }

  const productFor = (productId?: number, name?: string): Product | undefined => {
    const byId = productId != null ? productById.get(productId) : undefined;
    if (byId) return byId;
    return name ? productByName.get(norm(name)) : undefined;
  };
  const warrantyDaysOf = (productId?: number, name?: string): number => {
    const days = Math.round(Number(productFor(productId, name)?.warrantyDays) || 0);
    return days > 0 ? days : 0;
  };

  const rows: WarrantyRegisterRow[] = [];
  const saleById = new Map(input.sales.map(s => [s.id, s]));
  const saleByInvoice = new Map<string, Sale>();
  for (const sale of input.sales) {
    if (sale.status === 'Cancelled') continue;
    const key = norm(sale.invoice);
    if (key && !saleByInvoice.has(key)) saleByInvoice.set(key, sale);
  }

  const receiptById = new Map<number, WarrantyReceipt>();
  for (const receipt of input.receipts || []) receiptById.set(receipt.id, receipt);
  const replacementByClaim = new Map<string, WarrantyReplacement>();
  for (const replacement of input.replacements || []) {
    // Pending/cancelled vouchers post no stock and hand over no unit, so they
    // must not lend a "new serial" to the register row.
    const completed = replacement.stage
      ? replacement.stage === 'completed'
      : isWarrantyCompleted(replacement.status);
    if (!completed) continue;
    const key = norm(replacement.receiptClaimNo);
    if (key && !replacementByClaim.has(key)) replacementByClaim.set(key, replacement);
  }

  const saleClaims = input.sales
    .filter(s => !!s.warranty && s.status !== 'Cancelled')
    .map(s => ({ saleId: s.id, invoice: norm(s.invoice), claim: s.warranty as WarrantyClaimInfo }));
  const saleClaimByNo = new Map<string, WarrantyClaimInfo>();
  for (const source of saleClaims) {
    const no = norm(source.claim.claimNo);
    if (no && !saleClaimByNo.has(no)) saleClaimByNo.set(no, source.claim);
  }

  // An intake document keeps the live status (a replacement voucher updates it),
  // so it outranks the copy embedded in the sale it came from.
  const receiptSources = (input.receipts || [])
    .filter(receipt => !!norm(receipt.claimNo))
    .map(receipt => ({
      saleId: receipt.saleId,
      receiptId: receipt.id as number | undefined,
      invoice: norm(receipt.invoiceNumber),
      claim: receiptClaimInfo(
        receipt,
        saleClaimByNo.get(norm(receipt.claimNo)),
        replacementByClaim.get(norm(receipt.claimNo))
      )
    }));
  const receiptClaimNos = new Set(receiptSources.map(source => norm(source.claim.claimNo)));
  const claimSources = [
    ...receiptSources,
    ...saleClaims
      .filter(source => {
        const no = norm(source.claim.claimNo);
        return !no || !receiptClaimNos.has(no);
      })
      .map(source => ({ ...source, receiptId: undefined as number | undefined }))
  ];
  const usedClaims = new Set<number>();
  const manualClaim = new Map<number, WarrantyClaimInfo>();

  // 1) Selling warranties, one row per sold line that carries a period.
  for (const sale of input.sales) {
    if (sale.status !== 'Completed') continue;
    const invoice = norm(sale.invoice);
    const date = isoDay(sale.date);
    if (!date) continue;
    for (const item of sale.items || []) {
      const months = Math.max(0, Math.round(Number(item.warrantyMonths) || 0));
      const days = months ? months * 30 : warrantyDaysOf(item.productId, item.productName);
      if (!days) continue;
      const itemSerial = (item.serialNumber || '').trim();
      let claim: WarrantyClaimInfo | undefined;
      for (let i = 0; i < claimSources.length; i++) {
        if (usedClaims.has(i)) continue;
        const source = claimSources[i];
        const oldSerial = (source.claim.oldSerial || '').trim();
        if (itemSerial && oldSerial && norm(itemSerial) === norm(oldSerial)) {
          claim = source.claim;
          usedClaims.add(i);
          break;
        }
        if (!oldSerial && invoice && source.invoice === invoice
          && (!source.claim.battery || norm(source.claim.battery) === norm(item.productName))) {
          claim = source.claim;
          usedClaims.add(i);
          break;
        }
      }
      const expiryDate = months ? addMonthsIso(date, months) : warrantyExpiryDate(date, days);
      const remainingDays = months && expiryDate
        ? daysBetweenIso(today, expiryDate)
        : warrantyRemainingDays(date, days, today);
      rows.push({
        key: `sale-${sale.id}-${item.id}`,
        source: 'sale',
        saleId: sale.id,
        type: 'Selling',
        state: claimStateFor(claim, remainingDays),
        customerName: sale.customerName || '',
        phoneNumber: sale.mobile || phoneOf(sale.customerName),
        productName: item.productName,
        serialNumber: itemSerial || (claim?.oldSerial || '').trim(),
        invoiceNumber: sale.invoice || '',
        date,
        quantity: Number(item.quantity) || 0,
        unit: item.unit || productFor(item.productId, item.productName)?.unit || '',
        warrantyDays: days,
        warrantyMonths: months || undefined,
        expiryDate,
        remainingDays,
        claim: claim ? toRowClaim(claim) : undefined
      });
    }
  }

  // 2) Supplier warranties start on the purchase date, once the stock is received.
  for (const purchase of input.purchases || []) {
    if (purchase.status !== 'Received') continue;
    const date = isoDay(purchase.date);
    if (!date) continue;
    for (const item of purchase.items || []) {
      const days = warrantyDaysOf(item.productId, item.productName);
      if (!days) continue;
      const remainingDays = warrantyRemainingDays(date, days, today);
      rows.push({
        key: `purchase-${purchase.id}-${item.id}`,
        source: 'purchase',
        purchaseId: purchase.id,
        type: 'Purchase',
        state: remainingDays <= 0 ? 'Expired' : 'Active',
        customerName: purchase.supplierName || '',
        phoneNumber: phoneOf(purchase.supplierName),
        productName: item.productName,
        serialNumber: '',
        invoiceNumber: purchase.invoice || '',
        date,
        quantity: Number(item.quantity) || 0,
        unit: item.unit || productFor(item.productId, item.productName)?.unit || '',
        warrantyDays: days,
        expiryDate: warrantyExpiryDate(date, days),
        remainingDays
      });
    }
  }

  // 3) Claims that could not be tied to a sold line still appear as their own
  //    row, unless a manual register entry already names the same serial/invoice.
  claimSources.forEach((source, index) => {
    if (usedClaims.has(index)) return;
    const claim = source.claim;
    const manualIndex = (input.manual || []).findIndex((entry, i) =>
      !manualClaim.has(i) && entry.type !== 'Purchase' && claimMatchesEntry(claim, entry));
    if (manualIndex >= 0) {
      manualClaim.set(manualIndex, claim);
      usedClaims.add(index);
      return;
    }
    const voucher = source.saleId != null ? saleById.get(source.saleId) : undefined;
    const receipt = source.receiptId != null ? receiptById.get(source.receiptId) : undefined;
    const original = saleByInvoice.get(norm(claim.originalInvoice));
    const date = isoDay(original?.date) || isoDay(receipt?.warrantyStart) || isoDay(claim.receiveDate) || isoDay(receipt?.date);
    // A product without a catalogue period still carries one on the receipt itself;
    // ignoring it would leave the register's expiry column blank.
    const days = warrantyDaysOf(receipt?.productId ?? claim.productId, receipt?.productName || claim.battery)
      || Math.round(Number(receipt?.warrantyDays) || 0)
      || Math.round(Number(claim.warrantyDays) || 0);
    const remainingDays = days && date ? warrantyRemainingDays(date, days, today) : 0;
    rows.push({
      key: source.receiptId != null ? `receipt-${source.receiptId}` : `claim-${source.saleId}`,
      source: source.receiptId != null ? 'receipt' : 'sale',
      receiptId: source.receiptId,
      saleId: source.saleId,
      type: 'Selling',
      state: claimStateFor(claim, remainingDays),
      customerName: original?.customerName || voucher?.customerName || receipt?.customerName || '',
      phoneNumber: original?.mobile || voucher?.mobile || receipt?.phone
        || phoneOf(original?.customerName || voucher?.customerName || receipt?.customerName || ''),
      productName: claim.battery || receipt?.productName || '',
      serialNumber: (claim.oldSerial || '').trim(),
      invoiceNumber: claim.originalInvoice || original?.invoice || receipt?.invoiceNumber || '',
      date,
      quantity: parseWarrantyQuantity(claim.quantity) || Number(receipt?.quantity) || 1,
      unit: receipt?.unit || productFor(claim.productId, claim.battery)?.unit || '',
      warrantyDays: days,
      expiryDate: warrantyExpiryDate(date, days),
      remainingDays,
      claim: toRowClaim(claim)
    });
  });

  // 4) Manual/legacy register entries, carrying a claim when one matches them.
  for (const [index, entry] of (input.manual || []).entries()) {
    const date = isoDay(entry.saleDate);
    // Legacy rows may name a catalogue product but keep no period of their own.
    const days = warrantyDaysOfRecord(entry) || warrantyDaysOf(undefined, entry.productName);
    const remainingDays = days && date ? warrantyRemainingDays(date, days, today) : Math.round(Number(entry.remainingDays) || 0);
    const matchedClaim = manualClaim.get(index);
    const isClaim = entry.type === 'Warranty Claims' || entry.type === 'Completed';
    const status = (entry.status || '').trim();
    const claim: WarrantyRowClaim | undefined = matchedClaim ? toRowClaim(matchedClaim) : isClaim ? {
      claimNo: '',
      originalInvoice: entry.invoiceNumber || '',
      battery: entry.productName || '',
      quantity: Number(entry.quantity) || 0,
      receiveDate: date,
      receiptNo: '',
      oldSerial: entry.serialNumber || '',
      replacementDate: '',
      deliveryNo: '',
      newSerial: '',
      status: status || (entry.type === 'Completed' ? WARRANTY_STATUS_COMPLETED : WARRANTY_STATUS_IN_PROGRESS)
    } : undefined;
    let state: WarrantyRowState;
    if (matchedClaim) state = claimStateFor(matchedClaim, remainingDays);
    else if (entry.type === 'Expired') state = 'Expired';
    else if (claim) state = isWarrantyCancelled(claim.status) ? 'Cancelled' : isWarrantyCompleted(claim.status) ? 'Replaced' : 'Claimed';
    else state = days > 0 && remainingDays <= 0 ? 'Expired' : 'Active';
    rows.push({
      key: `manual-${entry.id}`,
      source: 'manual',
      manualId: entry.id,
      type: entry.type === 'Purchase' ? 'Purchase' : 'Selling',
      state,
      customerName: entry.customerName || '',
      phoneNumber: entry.phoneNumber || '',
      productName: entry.productName || '',
      serialNumber: entry.serialNumber || '',
      invoiceNumber: entry.invoiceNumber || '',
      date,
      quantity: Number(entry.quantity) || 0,
      unit: entry.unit || '',
      warrantyDays: days,
      expiryDate: warrantyExpiryDate(date, days),
      remainingDays,
      claim,
      notes: entry.notes
    });
  }

  return rows.sort((a, b) =>
    (b.date || '').localeCompare(a.date || '')
    || (a.customerName || '').localeCompare(b.customerName || '')
    || a.productName.localeCompare(b.productName));
}

function claimStateFor(claim: WarrantyClaimInfo | undefined, remainingDays: number): WarrantyRowState {
  if (claim && !isWarrantyCancelled(claim.status)) {
    return isWarrantyCompleted(claim.status) ? 'Replaced' : 'Claimed';
  }
  return remainingDays <= 0 ? 'Expired' : 'Active';
}

export type WarrantyTab = 'Selling' | 'Purchase' | 'Warranty Claims' | 'Completed' | 'Expired';

export function warrantyRowsForTab(rows: WarrantyRegisterRow[], tab: WarrantyTab): WarrantyRegisterRow[] {
  switch (tab) {
    case 'Selling':
      return rows.filter(r => r.type === 'Selling' && r.state !== 'Expired');
    case 'Purchase':
      return rows.filter(r => r.type === 'Purchase' && r.state !== 'Expired');
    case 'Warranty Claims':
      return rows.filter(r => !!r.claim);
    case 'Completed':
      return rows.filter(r => !!r.claim && isWarrantyCompleted(r.claim.status));
    case 'Expired':
      return rows.filter(r => r.state === 'Expired');
  }
}

export function warrantyRowMatches(row: WarrantyRegisterRow, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  return [
    row.customerName,
    row.phoneNumber,
    row.productName,
    row.serialNumber,
    row.invoiceNumber,
    row.claim?.claimNo,
    row.claim?.oldSerial,
    row.claim?.newSerial,
    row.claim?.receiptNo,
    row.claim?.deliveryNo
  ].some(value => norm(value).includes(q));
}
