import { Injectable, inject, signal, computed, effect, Injector, runInInjectionContext, WritableSignal } from '@angular/core';
import { downloadWorkbook, readSpreadsheetGrid } from '../utils/spreadsheet';
import { NotificationService } from './notification';
import { PreferencesService } from './preferences';
import { StorageService } from './storage';
import { CloudService } from './cloud';
import { localDateIso } from '../utils/local-date';
import { buildWarrantyRegister, isWarrantyCancelled, isWarrantyCompleted, isoDay, parseWarrantyQuantity } from '../utils/warranty';
import { parseVariationValues, serializeVariationValues } from '../utils/variation-values';
import { hasProductModel, productModelsOf, replaceProductModel } from '../utils/product-models';
import { productStockValuation } from '../utils/stock-valuation';

export interface ProductVariant {
  id: number;
  variationId: number;
  variationName: string;
  variantValue: string;
  itemCode: string;
  image?: string;
  quantityAlert?: number;
  mrp?: number;
  tax?: number;
  purchasePrice: number;
  purchaseTaxType?: string;
  wholesalePrice: number;
  salesPrice: number;
  salesTaxType?: string;
  wholesaleQuantity?: number;
  openingStock: number;
  openingStockDate?: string;
}

export interface ProductUnit {
  /** Display name of the extra selling unit, e.g. কেজি. */
  name: string;
  /**
   * How many base units one of this unit holds (1 কেজি = 1000 গ্রাম → 1000).
   * 1 means the unit shares the stock count one-for-one (গজ/কেজি/পিস একই স্টক).
   */
  factor: number;
  /** Price per this unit; absent derives from the base sales price × factor. */
  price?: number;
}

export interface Product {
  id: number;
  name: string;
  slug?: string;
  code: string;
  rack: string;
  warehouse?: string;
  type: 'single' | 'variant' | 'service';
  category: string;
  subCategory?: string;
  brand: string;
  model: string;
  stock: number;
  unit: string;
  /** Extra selling units; stock always stays counted in `unit`. */
  units?: ProductUnit[];
  salesPrice: number;
  purchasePrice: number;
  wholesalePrice: number;
  image?: string;
  barcodeSymbology?: string;
  tax?: number;
  openingStock?: number;
  openingStockDate?: string;
  mrp?: number;
  minQty?: number;
  purchaseTaxMode?: string;
  salesTaxMode?: string;
  wholesaleQuantity?: number;
  /** Warranty period in days; 0/absent means the product carries no warranty. */
  warrantyDays?: number;
  variants?: ProductVariant[];
}

/** Result of reading a catalog sheet, shown before anything is written. */
export interface ProductImportSummary {
  totalRows: number;
  added: number;
  updated: number;
  skipped: number;
  variants: number;
  newCategories: string[];
  newSubCategories: string[];
  newBrands: string[];
  newModels: string[];
  warnings: string[];
}

interface BuiltProductImport {
  merged: Product[];
  added: Product[];
  updated: number;
  skipped: number;
  variants: number;
  totalRows: number;
  warnings: string[];
}

interface PlannedTaxonomy {
  newCategories: Category[];
  newSubCategories: SubCategory[];
  newBrands: Brand[];
  newModels: ProductModel[];
  createdVariations: { id: number; name: string; values: string[] }[];
}

export interface Category {
  id: number;
  name: string;
  logo: string;
  productCount: number;
  status: 'Enabled' | 'Disabled';
  subCategories?: string[];
}

export interface SubCategory {
  id: number;
  name: string;
  slug: string;
  parentCategory: string;
  logo: string;
  productCount: number;
  status: 'Enabled' | 'Disabled';
}

export interface Brand {
  id: number;
  name: string;
  logo: string;
  productCount: number;
}

export interface ProductModel {
  id: number;
  name: string;
  logo: string;
}

/** Selling/purchase unit of a product (পিস, কেজি, লিটার…). */
export interface UnitOption {
  id: number;
  name: string;
  /** Preselected on the add-product form; exactly one unit carries it. */
  isDefault?: boolean;
}

export const DEFAULT_UNITS = ['পিস', 'DRAM', 'KG', 'Packet', 'Litre', 'Box'];
export const FALLBACK_UNIT = 'পিস';

export interface Variation {
  id: number;
  name: string;
  values: string;
}

/** A deleted record kept aside so the shop can put it back by mistake-free choice. */
export interface RecycleEntry {
  id: number;
  /** collection key of the record (sm_sales_v1, sm_products_v2, …) */
  collection: string;
  kind: string;
  title: string;
  recordId: number;
  deletedAt: string;
  payload: unknown;
  /** cascaded rows removed together with the record (wallet transactions) */
  cascade?: { collection: string; rows: unknown[] };
}

export type PartyType = 'Customer' | 'Corporate Customer' | 'Supplier' | 'Dealer' | 'Staff Member';

/** One dated promise to pay part of the due; history keeps earlier dates and contact notes. */
export interface ReminderHistoryEntry {
  at: string;
  kind: 'set' | 'date' | 'note' | 'payment' | 'done';
  date?: string;
  oldDate?: string;
  amount?: number;
  text?: string;
}

export interface PaymentPromise {
  /** ISO date the party promised to pay. */
  date: string;
  /** Taka promised for that date. */
  amount: number;
  /** Promised taka already collected through the reminder. */
  received: number;
  note?: string;
  createdAt: string;
  history: ReminderHistoryEntry[];
}

/** Roles that trade on the sales book (the shop sells to them). */
export const SALES_PARTY_TYPES: PartyType[] = ['Customer', 'Corporate Customer', 'Dealer'];

/** Roles that trade on the purchase book (the shop buys from them). */
export const PURCHASE_PARTY_TYPES: PartyType[] = ['Supplier'];

export const ALL_PARTY_TYPES: PartyType[] = [...SALES_PARTY_TYPES, 'Supplier', 'Staff Member'];

export interface Party {
  id: number;
  name: string;
  companyName: string;
  /** Primary role, kept for older screens; `roles` holds the full list. */
  type: PartyType;
  /** Every role the party holds. A supplier can also be a customer, and vice versa. */
  roles?: PartyType[];
  total: number;
  paid: number;
  due: number;
  /** Sales book (receivable): what the party bought from the shop. */
  salesTotal?: number;
  salesPaid?: number;
  salesDue?: number;
  salesAdvance?: number;
  /** Purchase book (payable): what the shop bought from the party. */
  purchaseTotal?: number;
  purchasePaid?: number;
  purchaseDue?: number;
  purchaseAdvance?: number;
  /** Cash paid beyond the outstanding due; it settles the next bill instead of disappearing. */
  advance?: number;
  status: 'Enabled' | 'Disabled';
  inHand: string;
  zone: string;
  email: string;
  phone?: string;
  /** Additional mobile numbers beyond the primary `phone`. */
  phones?: string[];
  createdAt: string;
  address: string;
  addressText?: string;
  documents?: string;
  nextPayment?: string;
  /** Legacy single-date reminder (kept so old saves migrate); new UI uses `paymentPromise`. */
  paymentReminderDate?: string;
  /** Active due-collection promise with amount, partial receipts and a change history. */
  paymentPromise?: PaymentPromise;
  role?: string;
  warehouse?: string;
  profileImage?: string;
  openingBalance?: number;
  openingBalanceType?: 'Pay' | 'Receive';
  taxNumber?: string;
  creditPeriod?: number;
  creditLimitMode?: 'Manual' | 'Rule-based';
  creditLimit?: number;
  remarks?: string;
  division?: string;
  district?: string;
  upazila?: string;
  thana?: string;
  areaRoadHouse?: string;
  geofencing?: boolean;
}

export type PartySide = 'sales' | 'purchase';

const partyRound = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

/** A fresh shop's first bill is Sale-1001, not Sale-0001. */
const SALE_SERIAL_START = 1000;

/** Purchase vouchers keep their own book, starting at PUR-3001. */
const PURCHASE_SERIAL_START = 3000;

/** Roles of a party. Legacy records only carry the single `type` field. */
export function partyRoles(party: Party): PartyType[] {
  const roles = (Array.isArray(party.roles) ? party.roles : []).filter(Boolean) as PartyType[];
  return roles.length ? Array.from(new Set(roles)) : [party.type];
}

export function hasPartyRole(party: Party, role: PartyType): boolean {
  return partyRoles(party).includes(role);
}

export function hasSalesRole(party: Party): boolean {
  return partyRoles(party).some(role => SALES_PARTY_TYPES.includes(role));
}

export function hasPurchaseRole(party: Party): boolean {
  return partyRoles(party).some(role => PURCHASE_PARTY_TYPES.includes(role));
}

/**
 * One subscriber must map to one party id, so `+880 1712-345678`, `8801712345678`
 * and `01712345678` all compare equal.
 */
export function partyPhoneKey(phone: string | null | undefined): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('88')) digits = digits.slice(2);
  return digits;
}

/** Every mobile number on a party, primary first, without blanks or duplicates. */
export function partyPhones(party: Pick<Party, 'phone' | 'phones'> | null | undefined): string[] {
  if (!party) return [];
  const extra = Array.isArray(party.phones) ? party.phones : [];
  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const raw of [party.phone, ...extra]) {
    const value = (raw || '').trim();
    if (!value || value === '-') continue;
    const key = partyPhoneKey(value) || value;
    if (seen.has(key)) continue;
    seen.add(key);
    numbers.push(value);
  }
  return numbers;
}

/**
 * A counter sale has no account: any party that happens to carry the walk-in
 * label must never collect a due, advance or credit-note balance.
 */
export function isWalkInCustomer(name: string | null | undefined): boolean {
  const key = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u200c\u200d]/g, '')
    .replace(/[\s\-\u2010-\u2015]+/g, ' ');
  return key === 'walk in customer' || key === 'ওয়াক ইন কাস্টমার';
}

export interface PartySideAccount {
  total: number;
  paid: number;
  due: number;
  advance: number;
}

/** Sales-side book. Falls back to the legacy columns for un-migrated records. */
export function salesAccountOf(party: Party): PartySideAccount {
  const legacy = party.type !== 'Supplier';
  return {
    total: partyRound(party.salesTotal ?? (legacy ? party.total : 0)),
    paid: partyRound(party.salesPaid ?? (legacy ? party.paid : 0)),
    due: partyRound(party.salesDue ?? (legacy ? party.due : 0)),
    advance: partyRound(party.salesAdvance ?? (legacy ? party.advance : 0))
  };
}

/** Purchase-side book. Falls back to the legacy columns for un-migrated records. */
export function purchaseAccountOf(party: Party): PartySideAccount {
  const legacy = party.type === 'Supplier';
  return {
    total: partyRound(party.purchaseTotal ?? (legacy ? party.total : 0)),
    paid: partyRound(party.purchasePaid ?? (legacy ? party.paid : 0)),
    due: partyRound(party.purchaseDue ?? (legacy ? party.due : 0)),
    advance: partyRound(party.purchaseAdvance ?? (legacy ? party.advance : 0))
  };
}

export function accountOf(party: Party, side: PartySide): PartySideAccount {
  return side === 'purchase' ? purchaseAccountOf(party) : salesAccountOf(party);
}

/** Promised taka still to collect: the promise's own remainder, capped by the live due. */
export function promiseRemaining(party: Party): number {
  const promise = party.paymentPromise;
  if (!promise) return 0;
  const due = Math.max(0, salesAccountOf(party).due);
  const left = partyRound(promise.amount - promise.received);
  return Math.max(0, Math.min(left, due));
}

type InventoryKind = 'sale' | 'purchase' | 'credit' | 'supplier';
type InventoryRecord = Sale | Purchase | SalesReturn | SupplierReturn;
type InventoryChange = [InventoryKind, InventoryRecord, 1 | -1];

export interface SaleItem {
  id: number;
  variantId?: number;
  productId?: number;
  productName: string;
  quantity: number;
  unit: string;
  /** Base units per `unit` chosen at sale time (blank/1 = the base unit). */
  unitFactor?: number;
  salesPrice: number;
  originalPrice?: number;
  discount?: number;
  discountType?: 'fixed' | 'percent';
  total: number;
  /** Serial/IMEI captured at sale time, used to match warranty claims. */
  serialNumber?: string;
  /** Warranty period given on this sale line, in months (overrides the product default). */
  warrantyMonths?: number;
}

export interface BatteryAdjustmentItem {
  id: number;
  description: string;
  /** Quantity, measured in `unit` (kg by default for legacy rows). */
  weightKg: number;
  ratePerKg: number;
  total: number;
  /** Catalog key + unit chosen in the sale form's old-battery credit section. */
  kindKey?: string;
  unit?: BatteryUnit;
}

export interface SalesReturnItem {
  id: number;
  item: string;
  qty: string;
  rate: number;
  amount: number;
}

export interface WarrantyClaimInfo {
  claimNo: string;
  originalInvoice: string;
  battery: string;
  quantity: string;
  receiveDate: string;
  receiptNo: string;
  oldSerial: string;
  replacementDate: string;
  deliveryNo: string;
  newSerial: string;
  status: string;
  /** Product the claim was raised for, when the form could link one. */
  productId?: number;
  /** Replacement handed out; deducted from stock once the claim is completed. */
  replacementProductId?: number;
  replacementProductName?: string;
  replacementQty?: number;
  replacementUnit?: string;
  /** Warranty period snapshot (days) of the claimed product. */
  warrantyDays?: number;
  notes?: string;
}

export interface VoucherSettings {
  businessNamePart1: string;
  businessNamePart2: string;
  businessColor1: string;
  businessColor2: string;
  address: string;
  mobile: string;
  email: string;
  /** Printed under the header when filled (commercial invoice identification). */
  vatRegNo: string;
  tradeLicenseNo: string;
  soldBy: string;
  // Section show/hide toggles — every voucher honours these.
  showLogo: boolean;
  showWatermark: boolean;
  watermarkText: string;
  watermarkOpacity: number;
  watermarkRotation: number;
  showQRCode: boolean;
  /** Separate switch for POS receipts/POS invoice slips; the A4 voucher keeps showQRCode. */
  showPosQrCode: boolean;
  /** 'link' = public voucher URL, 'text' = the bill summary printed inside the QR itself. */
  qrMode: 'link' | 'text';
  qrSize: number;
  showOldBatteries: boolean;
  showReturnedGoods: boolean;
  showNotes: boolean;
  showGreeting: boolean;
  showTerms: boolean;
  showSummary: boolean;
  showSignatureImage: boolean;
  /** PAID / DUE stamp beside the invoice heading. */
  showPaymentStatus: boolean;
  /** Item code, serial and brand under the product description. */
  showItemCode: boolean;
  /** Customer / Office / Accounts copy label on multi-copy sheets. */
  showCopyLabels: boolean;
  /** Amount in words under the bill total. */
  showAmountInWords: boolean;
  accentColor: string;
  greetingText: string;
  notesText: string;
  /** Printed under the warranty claim block on a sale voucher; editable in voucher settings. */
  warrantyNote: string;
  term1: string;
  term2: string;
  // Per-voucher greeting/terms; term1/term2/greetingText above belong to the sales invoice.
  purchaseGreeting: string;
  purchaseTerm1: string;
  purchaseTerm2: string;
  /** Lets Add Sale bill any customer at the product's wholesale price, not only Dealer parties. */
  allowWholesalePrice: boolean;
  creditGreeting: string;
  creditTerm1: string;
  creditTerm2: string;
  debitGreeting: string;
  debitTerm1: string;
  debitTerm2: string;
  termsFontSize: number;
  signatureTitle: string;
  signatureImage: string;
  paperSize: 'A4' | 'A5' | 'Custom';
  printOrientation: 'portrait' | 'landscape';
  copiesPerPage: 1 | 2 | 4;
  customPaperWidthMm: number;
  customPaperHeightMm: number;
  /** White border kept inside every paper edge on preview, print and PDF. */
  pageMarginMm: number;
  fontFamily: string;
}

export interface Sale {
  id: number;
  invoice: string;
  /** Random key for the public QR link — the invoice number itself is guessable. */
  shareKey?: string;
  warehouse: string;
  date: string;
  customerName: string;
  partyId?: number;
  preparedBy: string;
  mechanic?: string;
  status: 'Completed' | 'Ordered' | 'Confirmed' | 'Processing' | 'Shipping' | 'Cancelled';
  total: number;
  paid: number;
  due: number;
  paymentStatus: 'Paid' | 'Unpaid' | 'Partially Paid';
  nextPayDate: string;
  notes: string;
  /** Customer-facing note captured at POS checkout; printed on the receipt and POS slip. */
  memoNote?: string;
  items: SaleItem[];
  previousDue?: number;
  shopName?: string;
  mobile?: string;
  address?: string;
  subtotal?: number;
  discount?: number;
  discountType?: 'fixed' | 'percent';
  orderDiscount?: number;
  orderDiscountType?: 'fixed' | 'percent';
  /** POS order-level tax and damage charges, kept so the voucher summary adds up. */
  taxAmount?: number;
  damageAmount?: number;
  shipping?: number;
  warrantyTransport?: number;
  cashReceived?: number;
  bankPayment?: number;
  /** Which non-cash channel the bankPayment came from; older sales have none. */
  paymentMode?: 'Cash' | 'Card' | 'bKash' | 'Nagad' | 'Bank' | 'Mixed';
  returns?: SalesReturnItem[];
  warranty?: WarrantyClaimInfo;
  /** Warranty receipt this sale's claim was posted to (intake, register, stock). */
  warrantyReceiptId?: number;
  batteryAdjustments?: BatteryAdjustmentItem[];
  batteryAdjustmentTotal?: number;
  /** Purchase voucher auto-created in old-battery stock for this sale's trade-in. */
  batteryVoucherId?: number;
}

export interface PurchaseItem {
  id: number;
  productId: number;
  productName: string;
  itemCode: string;
  unit: string;
  quantity: number;
  purchasePrice: number;
  subtotal: number;
  variantId?: number;
  variantValue?: string;
}

export interface Purchase {
  id: number;
  invoice: string;
  shareKey?: string;
  warehouse: string;
  date: string;
  supplierName: string;
  partyId?: number;
  preparedBy: string;
  status: 'Received' | 'Pending' | 'Ordered' | 'Manufacturing';
  total: number;
  paid: number;
  due: number;
  paymentStatus: 'Paid' | 'Unpaid' | 'Partially Paid';
  nextPayDate: string;
  notes: string;
  items?: PurchaseItem[];
  orderTax?: string;
  taxAmount?: number;
  purchaser?: string;
  installments?: string;
  discount?: number;
  discountType?: 'fixed' | 'percent';
  shipping?: number;
  paymentMode?: string;
  createdAt?: string;
}

export type StockAdjustmentReason = 'found' | 'count' | 'damage' | 'return' | 'other';

/** One physical-count correction; sales and purchases keep their own records. */
export interface StockAdjustment {
  id: number;
  date: string;
  productId: number;
  productName: string;
  code: string;
  unit: string;
  previousStock: number;
  newStock: number;
  delta: number;
  variants: { variantId: number; variantValue: string; previous: number; next: number }[];
  reason: StockAdjustmentReason;
  note?: string;
  user?: string;
  createdAt: string;
}

export type BatteryVoucherType = 'purchase' | 'sale' | 'exchange';

export type BatteryUnit = 'kg' | 'pcs';

export interface BatteryKind {
  key: string;
  bn: string;
  en: string;
  /** Fixed measuring unit, or 'either' when the operator picks kg/pcs (e.g. অন্যান্য). */
  unit: BatteryUnit | 'either';
}

/** Shared catalog for battery lines and the sale page's old-battery credit. */
export const BATTERY_KINDS: BatteryKind[] = [
  { key: 'scrap', bn: 'স্ক্র্যাপ / পাউডার', en: 'Scrap / Powder', unit: 'kg' },
  { key: 'ebike', bn: 'কাচড়া ইজিবাইক', en: 'E-bike Scrap', unit: 'pcs' },
  { key: 'water', bn: 'পানি / IPS', en: 'Water / IPS', unit: 'kg' },
  { key: 'ups', bn: 'UPS / MC', en: 'UPS / MC', unit: 'kg' },
  { key: 'other', bn: 'অন্যান্য', en: 'Other', unit: 'either' }
];

export function batteryKindByKey(key: string | undefined): BatteryKind | undefined {
  return BATTERY_KINDS.find(k => k.key === key || k.bn === key || k.en === key);
}

export interface BatteryLine {
  kind: string;
  kg: number;
  rate: number;
  /** 'kg' or 'pcs'; defaults to kg for rows saved before units existed. */
  unit?: BatteryUnit;
  /** Stable catalog key, kept alongside the localized label. */
  kindKey?: string;
}

export interface BatteryVoucher {
  id: number;
  type: BatteryVoucherType;
  voucherNo: string;
  shareKey?: string;
  date: string;
  partyName: string;
  /** Linked party record, when the seller/customer was picked from Parties. */
  partyId?: number;
  lot: string;
  lines: BatteryLine[];
  totalKg: number;
  total: number;
  /** Sale only: cost of the sold lot, used to compute profit. */
  cost?: number;
  /** Exchange only: the two batteries move separately. */
  receivedId?: string;
  receivedKg?: number;
  receivedCondition?: 'scrap' | 'usable';
  givenId?: string;
  givenKg?: number;
  fee?: number;
  cash: number;
  bank: number;
  mobile: number;
  mobileType?: 'bKash' | 'Nagad';
  ref: string;
  paid: number;
  due: number;
  notes: string;
  preparedBy: string;
  createdAt: string;
  /** 'sale-adjustment' rows come from an Add Sale trade-in and settle against that invoice. */
  source?: 'manual' | 'sale-adjustment';
  saleInvoice?: string;
  /** Wallet transactions posted by this voucher, kept for symmetric reversal. */
  walletTxnIds?: number[];
  /** Set once total/paid/due were posted to the party books, so reversal stays symmetric. */
  partyPosted?: boolean;
}

/** One purchase voucher the fund paid off, oldest purchases first. */
export interface BatteryFundAllocation {
  voucherId: number;
  voucherNo: string;
  amount: number;
}

/**
 * Money kept inside the old-battery stock: every purchase that is not paid yet
 * makes up the fund, and a transfer sends part of it to the seller's ledger.
 * `recordPayment` posts the party side (due first, then advance); the wallet row
 * and the linked receipt are reversed together when the transfer is removed.
 */
export interface BatteryFundTransfer {
  id: number;
  transferNo: string;
  date: string;
  partyId: number;
  partyName: string;
  amount: number;
  mode: LedgerPayment['mode'];
  accountId?: number;
  walletTxnId?: number;
  paymentId?: number;
  allocations: BatteryFundAllocation[];
  note: string;
  createdAt: string;
  createdBy?: string;
}

export interface BatterySummary {
  purchaseTotal: number;
  saleTotal: number;
  saleCost: number;
  exchangeFee: number;
  profit: number;
  /** Remaining kg stock — pieces are counted separately because the two cannot be added. */
  stockKg: number;
  stockPcs: number;
  stockValue: number;
  avgCostPerKg: number;
  /** Sales whose kilogram weight was never bought, so no purchase cost can be attached. */
  incompleteSales: number;
}

/** One dated stock movement, valued at its own purchase rate (running balance per kind). */
export interface BatteryStockRow {
  date: string;
  voucherNo: string;
  source: 'purchase' | 'sale' | 'exchange' | 'sale-adjustment';
  partyName: string;
  /** Catalog kind key (or 'exchange' for exchange movements). */
  kindKey: string;
  kind: string;
  unit: BatteryUnit;
  inQty: number;
  outQty: number;
  rate: number;
  amount: number;
  balanceQty: number;
  balanceValue: number;
}

/** Remaining stock of one battery kind, valued at that kind's average purchase rate. */
export interface BatteryKindStock {
  key: string;
  label: string;
  unit: BatteryUnit | 'mixed';
  qty: number;
  value: number;
  avgRate: number;
}

/**
 * Manual warranty register entry (records sold before the shop used the app, or
 * rows added by hand). Rows derived from sales and purchases never get stored —
 * they are rebuilt from the vouchers themselves.
 */
export interface ProductWarranty {
  id: number;
  customerName: string;
  phoneNumber: string;
  productName: string;
  serialNumber: string;
  invoiceNumber: string;
  saleDate: string;
  /** Legacy field; old rows stored the period here, so it doubles as warrantyDays. */
  remainingDays: number;
  type: 'Selling' | 'Purchase' | 'Warranty Claims' | 'Completed' | 'Expired';
  /** Warranty period in days (new rows); legacy rows fall back to remainingDays. */
  warrantyDays?: number;
  status?: string;
  quantity?: number;
  unit?: string;
  notes?: string;
}

export interface Expense {
  id: number;
  title: string;
  amount: number;
  category: string;
  date: string;
  note: string;
  /** Wallet account the money left from; older rows have none and never post. */
  accountId?: number;
  walletTxnId?: number;
}

// ------------------------------------------------------------------
// Advanced warranty: intake (claim) and replacement are two separate
// documents with their own numbering, and two separate stock pools.
// ------------------------------------------------------------------

export type WarrantyPool = 'received' | 'replacement';

/** A defective item handed in by a customer under warranty. */
export interface WarrantyReceipt {
  id: number;
  /** Auto-generated from the configurable receipt prefix (default WR-1001). */
  claimNo: string;
  date: string;
  customerName: string;
  phone: string;
  address?: string;
  invoiceNumber: string;
  saleId?: number;
  productId?: number;
  productName: string;
  serialNumber: string;
  quantity: number;
  unit: string;
  warrantyStart?: string;
  warrantyDays?: number;
  condition: string;
  reason: string;
  accessories?: string;
  expectedDate?: string;
  status: string;
  supplierId?: number;
  supplierName?: string;
  /** The defective unit physically entered the received pool. */
  stockIn: boolean;
  notes?: string;
  handledBy?: string;
  /** Set when a replacement voucher settles this claim. */
  replacementClaimNo?: string;
  replacedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

/** A replacement handed to the customer, optionally settling a receipt. */
export interface WarrantyReplacement {
  id: number;
  /** Auto-generated from the configurable replacement prefix (default WX-1001). */
  claimNo: string;
  date: string;
  receiptId?: number;
  receiptClaimNo?: string;
  customerName: string;
  phone: string;
  productId?: number;
  productName: string;
  serialNumber: string;
  quantity: number;
  unit: string;
  /** Warranty pool by default; the main product stock only when allowed. */
  source: 'warranty' | 'main';
  /** Replacement units received from the supplier into the replacement pool. */
  stockInQty: number;
  supplierId?: number;
  supplierName?: string;
  supplierRef?: string;
  /** The defective unit leaves the received pool (to supplier / scrap). */
  disposeReceived: boolean;
  disposition: string;
  cost: number;
  stage: 'completed' | 'pending' | 'cancelled';
  status: string;
  notes?: string;
  handledBy?: string;
  /** Status the settled receipt had before this voucher, restored on delete. */
  receiptPrevStatus?: string;
  createdAt: string;
  updatedAt?: string;
}

/** One signed movement in either warranty stock pool. */
export interface WarrantyStockMovement {
  id: number;
  date: string;
  pool: WarrantyPool;
  /** Signed: positive adds to the pool, negative removes from it. */
  quantity: number;
  productId?: number;
  productName: string;
  serialNumber?: string;
  unit: string;
  reason: 'receipt' | 'replacement' | 'supplier' | 'disposal' | 'manual' | 'return';
  refNo: string;
  claimId?: number;
  note?: string;
  createdAt: string;
}

export interface WarrantySettings {
  receiptPrefix: string;
  replacementPrefix: string;
  startNumber: number;
  defaultWarrantyDays: number;
  receiptStatuses: string[];
  receiptReplacedStatus: string;
  replacementStatuses: string[];
  conditions: string[];
  dispositions: string[];
  requireInvoice: boolean;
  requireSerial: boolean;
  allowMainStockReplacement: boolean;
  allowNegativeStock: boolean;
  autoSettleReceipt: boolean;
  printTitle: string;
  printFooter: string;
  printTerms: string;
}

/** Per-product balances of the two warranty pools. */
export interface WarrantyStockRow {
  key: string;
  productId?: number;
  productName: string;
  unit: string;
  received: number;
  replacement: number;
  lastDate: string;
}

export const LEDGER_MODES = ['Cash', 'Bank', 'bKash', 'Nagad'] as const;

export interface LedgerPayment {
  id: number;
  receiptNo: string;
  partyId: number;
  partyName: string;
  partyType: 'Customer' | 'Supplier';
  amount: number;
  discount: number;
  /** Part of amount+discount that exceeded the due and became an advance; the rest settled the due. */
  advance?: number;
  mode: 'Cash' | 'Bank' | 'bKash' | 'Nagad';
  date: string;
  note: string;
  createdAt: string;
  /** Set when a battery-fund transfer created this receipt; only that transfer may reverse it. */
  batteryFundTransferId?: number;
}

export interface SupplierReturnItem {
  variantId?: number;
  productId?: number;
  productName: string;
  quantity: number;
  itemCode?: string;
  unit?: string;
  unitPrice?: number;
  total?: number;
}

export interface SupplierReturn {
  id: number;
  returnNo: string;
  shareKey?: string;
  partyId: number;
  partyName: string;
  amount: number;
  date: string;
  note: string;
  invoiceNumber?: string;
  reason?: string;
  items?: SupplierReturnItem[];
  warehouse?: string;
  status?: string;
  discount?: number;
  discountType?: 'fixed' | 'percent';
  shipping?: number;
  orderTax?: string;
  taxAmount?: number;
  returnedBy?: string;
  createdAt: string;
}

export interface CashClosing {
  id: number;
  date: string;
  openingCash: number;
  cashSales: number;
  bankSales: number;
  collections: number;
  expenses: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  closedBy: string;
  closedAt: string;
}

// ------------------------------------------------------------------
// Sales Return / Credit Note
// ------------------------------------------------------------------
export interface CreditNoteItem {
  variantId?: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  productId?: number;
  itemCode?: string;
  unit?: string;
  /** Base units per returned `unit`, copied from the invoice line. */
  unitFactor?: number;
}

export interface SalesReturn {
  id: number;
  creditNoteNo: string;
  shareKey?: string;
  date: string;
  invoiceNumber: string;
  customerName: string;
  /** Linked party record; name-only notes are matched by name as a fallback. */
  partyId?: number;
  items: CreditNoteItem[];
  amount: number;
  reason: string;
  restock: boolean;
  status: 'Posted' | 'Draft' | 'Cancelled';
  note?: string;
  discount?: number;
  discountType?: 'fixed' | 'percent';
  shipping?: number;
  orderTax?: string;
  taxAmount?: number;
  returnedBy?: string;
  createdAt: string;
}

// ------------------------------------------------------------------
// Staff Advance
// ------------------------------------------------------------------
export interface StaffAdvance {
  id: number;
  advanceNo: string;
  /** HRM employee id when the staff was picked from the employee database. */
  staffId?: number;
  staffName: string;
  date: string;
  amount: number;
  recoveredAmount: number;
  /** Mirrors the paid account's type; legacy rows kept their own value. */
  mode: 'Cash' | 'Bank' | 'bKash' | 'Nagad' | 'Rocket';
  /** The wallet account the money left (and returns to on recovery). */
  accountId?: number;
  walletTxnId?: number;
  recoveryTxnIds?: number[];
  purpose: string;
  status: 'Pending' | 'Approved' | 'Recovered' | 'Cancelled';
  note: string;
  createdAt: string;
}

// ------------------------------------------------------------------
// Quotation / Estimate
// ------------------------------------------------------------------
export interface QuotationItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Quotation {
  id: number;
  quoteNo: string;
  date: string;
  validTill: string;
  customerName: string;
  phone: string;
  address: string;
  items: QuotationItem[];
  discount: number;
  total: number;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Converted';
  convertedInvoice: string;
  note: string;
  createdAt: string;
}

// ------------------------------------------------------------------
// Installments
// ------------------------------------------------------------------
export interface InstallmentPayment {
  date: string;
  amount: number;
  mode: 'Cash' | 'Bank' | 'bKash' | 'Nagad';
  note: string;
}

export interface Installment {
  id: number;
  installmentNo: string;
  customerName: string;
  phone: string;
  product: string;
  saleInvoice: string;
  date: string;
  totalAmount: number;
  downPayment: number;
  tenureMonths: number;
  monthlyAmount: number;
  payments: InstallmentPayment[];
  status: 'Active' | 'Completed' | 'Defaulted' | 'Cancelled';
  note: string;
  createdAt: string;
}

// ------------------------------------------------------------------
// Wallet (cash counter + mobile banking / bank accounts)
// ------------------------------------------------------------------
export interface WalletAccount {
  id: number;
  name: string;
  type: 'Cash' | 'bKash' | 'Nagad' | 'Rocket' | 'Bank';
  identifier: string;
  openingBalance: number;
  status: 'Enabled' | 'Disabled';
  note: string;
}

export interface WalletTransaction {
  id: number;
  txnNo: string;
  date: string;
  direction: 'In' | 'Out';
  accountId: number;
  amount: number;
  party: string;
  note: string;
  createdAt: string;
  /** Which HRM document produced this row, so it can be kept in step. */
  source?: 'Manual' | 'Salary' | 'Rent' | 'Expense' | 'Battery' | 'StaffAdvance';
  refId?: number;
}

// ------------------------------------------------------------------
// Observation log
// ------------------------------------------------------------------
export interface Observation {
  id: number;
  obsNo: string;
  date: string;
  target: string;
  category: 'Customer' | 'Staff' | 'Market' | 'Product' | 'Other';
  tone: 'Positive' | 'Negative' | 'Neutral';
  note: string;
  observer: string;
  followUpDate: string;
  status: 'Open' | 'Closed';
  createdAt: string;
}

// ------------------------------------------------------------------
// HRM
// ------------------------------------------------------------------
export interface HrmStaff {
  id: number;
  code: string;
  name: string;
  designation: string;
  phone: string;
  email: string;
  address: string;
  division?: string;
  district?: string;
  upazila?: string;
  /** Cloudinary URL, or a compressed data URL while offline. */
  photo?: string;
  joinDate: string;
  monthlySalary: number;
  status: 'Active' | 'On Leave' | 'Inactive';
  note: string;
  createdAt: string;
}

/** One row per employee per day; each scan fills the next empty punch. */
export interface AttendanceRecord {
  id: number;
  staffId: number;
  staffCode: string;
  staffName: string;
  date: string;
  timeIn: string;
  /** Leaving for the lunch break. */
  lunchOut?: string;
  /** Back from the lunch break. */
  lunchIn?: string;
  timeOut: string;
  method: 'QR' | 'Face' | 'Manual';
  status: 'Present' | 'Late' | 'Absent' | 'Leave';
  /** Compressed selfie kept as proof for face check-in. */
  photo?: string;
  /** Set while an approved leave owns this day. */
  leaveId?: number;
  note: string;
  createdAt: string;
}

export type LeaveType = 'Casual' | 'Sick' | 'Annual' | 'Unpaid';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

/**
 * A leave request for a date range. Approval writes the matching attendance
 * rows (see DataService), so payroll and the attendance page stay in step.
 */
export interface HrmLeave {
  id: number;
  staffId: number;
  staffCode: string;
  staffName: string;
  fromDate: string;
  toDate: string;
  type: LeaveType;
  reason: string;
  status: LeaveStatus;
  note: string;
  createdAt: string;
  decidedAt: string;
}

export interface SalaryPayment {
  id: number;
  voucherNo: string;
  staffId: number;
  staffCode: string;
  staffName: string;
  month: string;
  workingDays: number;
  presentDays: number;
  lateDays: number;
  leaveDays: number;
  monthlySalary: number;
  perDay: number;
  basicPay: number;
  allowance: number;
  deduction: number;
  advanceAdjusted: number;
  netPay: number;
  date: string;
  accountId: number;
  note: string;
  createdAt: string;
  walletTxnId?: number;
  /** Which advances this payment recovered, so deleting it can give them back. */
  advanceAllocations?: { advanceId: number; amount: number }[];
}

export interface RentPayment {
  id: number;
  voucherNo: string;
  month: string;
  title: string;
  amount: number;
  date: string;
  accountId: number;
  status: 'Paid' | 'Due';
  note: string;
  createdAt: string;
  walletTxnId?: number;
}

// ------------------------------------------------------------------
// Online Requests (leads coming from web / social / phone)
// ------------------------------------------------------------------
export interface OnlineRequest {
  id: number;
  requestNo: string;
  date: string;
  customerName: string;
  phone: string;
  address: string;
  channel: 'Website' | 'Facebook' | 'WhatsApp' | 'Phone' | 'Walk-in';
  product: string;
  quantity: number;
  expectedPrice: number;
  status: 'New' | 'Contacted' | 'Confirmed' | 'Cancelled';
  note: string;
  createdAt: string;
}

// ------------------------------------------------------------------
// Damage Records
// ------------------------------------------------------------------
export interface DamageRecord {
  id: number;
  damageNo: string;
  date: string;
  productName: string;
  /** Set when the damage line came from a variant, so stock moves on that variant. */
  variantId?: number;
  quantity: number;
  unitCost: number;
  lossAmount: number;
  warehouse: string;
  reason: string;
  action: 'Scrapped' | 'Repaired' | 'Returned to Supplier' | 'Written Off';
  status: 'Reported' | 'Approved' | 'Resolved';
  stockDeducted: boolean;
  note: string;
  createdAt: string;
}


@Injectable({
  providedIn: 'root'
})
export class DataService {
  private notify = inject(NotificationService);
  private storage = inject(StorageService);
  private prefs = inject(PreferencesService);
  // CloudService already injects DataService, so resolve this one on demand —
  // injecting it here directly is a circular dependency (NG0200).
  private cloudService?: CloudService;
  private get cloud(): CloudService {
    return (this.cloudService ??= this.injector.get(CloudService));
  }
  private injector = inject(Injector);

  // Signals for Reactive State
  readonly products = signal<Product[]>([]);

  readonly categories = signal<Category[]>([]);

  readonly subCategories = signal<SubCategory[]>([]);

  readonly brands = signal<Brand[]>([]);

  readonly productModels = signal<ProductModel[]>([]);

  readonly units = signal<UnitOption[]>([]);

  readonly variations = signal<Variation[]>([]);

  readonly parties = signal<Party[]>([]);

  readonly sales = signal<Sale[]>([]);

  readonly purchases = signal<Purchase[]>([]);

  readonly stockAdjustments = signal<StockAdjustment[]>([]);

  readonly warranties = signal<ProductWarranty[]>([]);

  readonly warrantyReceipts = signal<WarrantyReceipt[]>([]);

  readonly warrantyReplacements = signal<WarrantyReplacement[]>([]);

  readonly warrantyStockMovements = signal<WarrantyStockMovement[]>([]);

  readonly expenses = signal<Expense[]>([]);

  readonly payments = signal<LedgerPayment[]>([]);

  readonly supplierReturns = signal<SupplierReturn[]>([]);

  readonly cashClosings = signal<CashClosing[]>([]);

  readonly salesReturns = signal<SalesReturn[]>([]);

  readonly staffAdvances = signal<StaffAdvance[]>([]);

  readonly quotations = signal<Quotation[]>([]);

  readonly installments = signal<Installment[]>([]);

  readonly walletAccounts = signal<WalletAccount[]>([
    { id: 1, name: 'ক্যাশ কাউন্টার', type: 'Cash', identifier: '', openingBalance: 0, status: 'Enabled', note: 'দোকানের নগদ বাক্স' },
    { id: 2, name: 'bKash', type: 'bKash', identifier: '', openingBalance: 0, status: 'Enabled', note: '' },
    { id: 3, name: 'Nagad', type: 'Nagad', identifier: '', openingBalance: 0, status: 'Enabled', note: '' },
    { id: 4, name: 'ব্যাংক অ্যাকাউন্ট', type: 'Bank', identifier: '', openingBalance: 0, status: 'Enabled', note: '' }
  ]);

  readonly walletTransactions = signal<WalletTransaction[]>([]);

  readonly observations = signal<Observation[]>([]);

  readonly hrmStaff = signal<HrmStaff[]>([]);

  readonly attendance = signal<AttendanceRecord[]>([]);

  readonly hrmLeaves = signal<HrmLeave[]>([]);

  readonly salaryPayments = signal<SalaryPayment[]>([]);

  readonly rentPayments = signal<RentPayment[]>([]);

  readonly onlineRequests = signal<OnlineRequest[]>([]);

  readonly damageRecords = signal<DamageRecord[]>([]);

  readonly batteryVouchers = signal<BatteryVoucher[]>([]);

  readonly batteryFundTransfers = signal<BatteryFundTransfer[]>([]);

  readonly warehouses = signal<string[]>(['SM Warehouse']);

  readonly recycleBin = signal<RecycleEntry[]>([]);

  readonly totalStockItemsCount = computed(() => {
    return this.products().length;
  });

  readonly totalReceivable = computed(() => {
    return this.parties()
      .reduce((acc, p) => acc + salesAccountOf(p).due, 0);
  });

  readonly totalPayable = computed(() => {
    return this.parties()
      .reduce((acc, p) => acc + purchaseAccountOf(p).due, 0);
  });

  readonly lowStockProducts = computed(() => {
    return this.products()
      .filter(p => p.type !== 'service' && p.stock <= (p.minQty && p.minQty > 0 ? p.minQty : 5))
      .sort((a, b) => a.stock - b.stock);
  });

  readonly stockValueCost = computed(() => {
    return this.products().reduce((acc, p) => acc + productStockValuation(p).cost, 0);
  });

  readonly stockValueSales = computed(() => {
    return this.products().reduce((acc, p) => acc + productStockValuation(p).sales, 0);
  });

  /**
   * One warranty register built from the vouchers themselves plus the manual
   * rows, so a claim never has to be entered twice.
   */
  readonly warrantyRegister = computed(() => {
    const phoneByName = new Map<string, string>();
    for (const party of this.parties()) {
      const key = (party.name || '').trim().toLowerCase();
      if (key && party.phone && !phoneByName.has(key)) phoneByName.set(key, party.phone);
    }
    return buildWarrantyRegister({
      sales: this.sales(),
      purchases: this.purchases(),
      products: this.products(),
      manual: this.warranties(),
      receipts: this.warrantyReceipts(),
      replacements: this.warrantyReplacements(),
      phoneOf: name => phoneByName.get((name || '').trim().toLowerCase()) || ''
    });
  });

  warrantyStockKey(productId: number | undefined, productName: string, unit: string): string {
    const product = productId != null ? `id:${productId}` : `name:${(productName || '').trim().toLowerCase()}`;
    return JSON.stringify([product, (unit || '').trim()]);
  }

  readonly warrantyStockRows = computed<WarrantyStockRow[]>(() => {
    const rows = new Map<string, WarrantyStockRow>();
    for (const movement of this.warrantyStockMovements()) {
      const key = this.warrantyStockKey(movement.productId, movement.productName, movement.unit);
      const row = rows.get(key) ?? {
        key,
        productId: movement.productId,
        productName: movement.productName || '',
        unit: movement.unit || '',
        received: 0,
        replacement: 0,
        lastDate: ''
      };
      if (movement.pool === 'received') row.received += Number(movement.quantity) || 0;
      else row.replacement += Number(movement.quantity) || 0;
      if ((movement.date || '') >= row.lastDate) row.lastDate = movement.date || '';
      if (!row.unit && movement.unit) row.unit = movement.unit;
      rows.set(key, row);
    }
    return [...rows.values()]
      .map(row => ({
        ...row,
        received: this.roundMoney(row.received),
        replacement: this.roundMoney(row.replacement)
      }))
      .sort((a, b) => (a.productName || '').localeCompare(b.productName || ''));
  });

  warrantyStockOf(productId: number | undefined, productName: string, unit: string): { received: number; replacement: number } {
    const key = this.warrantyStockKey(productId, productName, unit);
    let received = 0;
    let replacement = 0;
    for (const movement of this.warrantyStockMovements()) {
      if (this.warrantyStockKey(movement.productId, movement.productName, movement.unit) !== key) continue;
      if (movement.pool === 'received') received += Number(movement.quantity) || 0;
      else replacement += Number(movement.quantity) || 0;
    }
    return { received: this.roundMoney(received), replacement: this.roundMoney(replacement) };
  }

  readonly openWarrantyReceipts = computed(() =>
    this.warrantyReceipts().filter(receipt =>
      !receipt.replacementClaimNo
      && !isWarrantyCompleted(receipt.status)
      && !isWarrantyCancelled(receipt.status)));

  // Action Methods
  addProduct(newProduct: Omit<Product, 'id'>) {
    const id = this.newId();
    this.products.update(list => [{ ...newProduct, id }, ...list]);
  }

  updateProduct(updated: Product) {
    this.products.update(list => list.map(p => p.id === updated.id ? updated : p));
  }

  deleteProduct(id: number) {
    this.archive('sm_products_v2', 'পণ্য', this.products().find(p => p.id === id));
    this.products.update(list => list.filter(p => p.id !== id));
  }

  addWarehouse(name: string): { ok: boolean; error?: string } {
    const value = name.trim();
    if (!value) return { ok: false, error: 'required' };
    if (this.warehouses().some(item => item.toLowerCase() === value.toLowerCase())) {
      return { ok: false, error: 'duplicate' };
    }
    this.warehouses.update(list => [...list, value]);
    return { ok: true };
  }

  /** Renaming also moves every product so stock never points at a dead warehouse. */
  renameWarehouse(from: string, to: string): { ok: boolean; error?: string } {
    const value = to.trim();
    if (!this.warehouses().includes(from)) return { ok: false, error: 'missing' };
    if (!value) return { ok: false, error: 'required' };
    if (this.warehouses().some(item => item !== from && item.toLowerCase() === value.toLowerCase())) {
      return { ok: false, error: 'duplicate' };
    }
    if (value === from) return { ok: true };
    this.warehouses.update(list => list.map(item => item === from ? value : item));
    this.products.update(list => list.map(product => product.warehouse === from ? { ...product, warehouse: value } : product));
    return { ok: true };
  }

  deleteWarehouse(name: string): { ok: boolean; error?: string; count?: number } {
    if (!this.warehouses().includes(name)) return { ok: false, error: 'missing' };
    if (this.warehouses().length <= 1) return { ok: false, error: 'last' };
    const used = this.products().filter(product => product.warehouse === name).length;
    if (used) return { ok: false, error: 'inUse', count: used };
    this.warehouses.update(list => list.filter(item => item !== name));
    return { ok: true };
  }

  addCategory(category: Omit<Category, 'id'>) {
    const key = this.normalizeKey(category.name);
    if (this.categories().some(c => this.normalizeKey(c.name) === key)) return;
    const id = this.newId();
    this.categories.update(list => [{ ...category, id }, ...list]);
  }

  deleteCategory(id: number) {
    this.archive('sm_categories_v2', 'ক্যাটাগরি', this.categories().find(c => c.id === id));
    this.categories.update(list => list.filter(c => c.id !== id));
  }

  reorderCategories(list: Category[]) {
    this.categories.set(list);
  }

  addSubCategory(subCat: Omit<SubCategory, 'id'>) {
    const key = `${this.normalizeKey(subCat.parentCategory)}|${this.normalizeKey(subCat.name)}`;
    if (this.subCategories().some(s => `${this.normalizeKey(s.parentCategory)}|${this.normalizeKey(s.name)}` === key)) return;
    const id = this.newId();
    this.subCategories.update(list => [{ ...subCat, id }, ...list]);
  }

  deleteSubCategory(id: number) {
    this.archive('sm_sub_categories_v2', 'সাব ক্যাটাগরি', this.subCategories().find(s => s.id === id));
    this.subCategories.update(list => list.filter(s => s.id !== id));
  }

  reorderSubCategories(list: SubCategory[]) {
    this.subCategories.set(list);
  }

  addBrand(brand: Omit<Brand, 'id'>) {
    const key = this.normalizeKey(brand.name);
    if (this.brands().some(b => this.normalizeKey(b.name) === key)) return;
    const id = this.newId();
    this.brands.update(list => [{ ...brand, id }, ...list]);
  }

  deleteBrand(id: number) {
    this.archive('sm_brands_v2', 'ব্র্যান্ড', this.brands().find(b => b.id === id));
    this.brands.update(list => list.filter(b => b.id !== id));
  }

  reorderBrands(list: Brand[]) {
    this.brands.set(list);
  }

  addProductModel(model: Omit<ProductModel, 'id'>) {
    const key = this.normalizeKey(model.name);
    if (this.productModels().some(m => this.normalizeKey(m.name) === key)) return;
    const id = this.newId();
    this.productModels.update(list => [{ ...model, id }, ...list]);
  }

  deleteProductModel(id: number) {
    this.archive('sm_product_models_v2', 'প্রোডাক্ট মডেল', this.productModels().find(m => m.id === id));
    this.productModels.update(list => list.filter(m => m.id !== id));
  }

  reorderProductModels(list: ProductModel[]) {
    this.productModels.set(list);
  }

  // ------------------------------------------------------------------
  // Units (managed in Settings; the product form defaults to the marked one)
  // ------------------------------------------------------------------
  private seedUnits(): UnitOption[] {
    return DEFAULT_UNITS.map((name, index) => ({ id: index + 1, name, isDefault: index === 0 }));
  }

  /** Preselected on a new product; পিস is the fallback when nothing is marked. */
  defaultUnitName(): string {
    const list = this.units();
    return (list.find(unit => unit.isDefault) ?? list[0])?.name || FALLBACK_UNIT;
  }

  unitNames(): string[] {
    const names = this.units().map(unit => unit.name);
    return names.length ? names : [FALLBACK_UNIT];
  }

  unitProductCount(name: string): number {
    const key = this.normalizeKey(name);
    return this.products().filter(p => this.normalizeKey(p.unit) === key).length;
  }

  addUnit(name: string): { ok: boolean; error?: 'required' | 'duplicate' } {
    const clean = (name || '').trim();
    if (!clean) return { ok: false, error: 'required' };
    if (this.units().some(unit => this.normalizeKey(unit.name) === this.normalizeKey(clean))) {
      return { ok: false, error: 'duplicate' };
    }
    // The first unit of an empty shop becomes the default automatically.
    const unit: UnitOption = { id: this.newId(), name: clean, isDefault: !this.units().length };
    this.units.update(list => [...list, unit]);
    return { ok: true };
  }

  renameUnit(id: number, name: string): { ok: boolean; error?: 'required' | 'duplicate' | 'missing' } {
    const clean = (name || '').trim();
    if (!clean) return { ok: false, error: 'required' };
    const current = this.units().find(unit => unit.id === id);
    if (!current) return { ok: false, error: 'missing' };
    if (this.units().some(unit => unit.id !== id && this.normalizeKey(unit.name) === this.normalizeKey(clean))) {
      return { ok: false, error: 'duplicate' };
    }
    const oldKey = this.normalizeKey(current.name);
    this.units.update(list => list.map(unit => unit.id === id ? { ...unit, name: clean } : unit));
    // Products store the unit by name, so a rename must follow through.
    if (this.normalizeKey(clean) !== oldKey) {
      this.products.update(list => list.map(p => this.normalizeKey(p.unit) === oldKey ? { ...p, unit: clean } : p));
    }
    return { ok: true };
  }

  setDefaultUnit(id: number): void {
    if (!this.units().some(unit => unit.id === id)) return;
    this.units.update(list => list.map(unit => ({ ...unit, isDefault: unit.id === id })));
  }

  deleteUnit(id: number): { ok: boolean; error?: 'missing' | 'default' | 'in-use' | 'last' } {
    const unit = this.units().find(item => item.id === id);
    if (!unit) return { ok: false, error: 'missing' };
    if (this.units().length <= 1) return { ok: false, error: 'last' };
    if (unit.isDefault) return { ok: false, error: 'default' };
    if (this.unitProductCount(unit.name) > 0) return { ok: false, error: 'in-use' };
    this.units.update(list => list.filter(item => item.id !== id));
    return { ok: true };
  }

  addVariation(variation: Omit<Variation, 'id'>) {
    const id = this.newId();
    this.variations.update(list => [{ ...variation, id }, ...list]);
  }

  deleteVariation(id: number) {
    this.archive('sm_variations_v2', 'ভ্যারিয়েশন', this.variations().find(v => v.id === id));
    this.variations.update(list => list.filter(v => v.id !== id));
  }

  private normalizeKey(value: string | null | undefined): string {
    return (value || '').normalize('NFC').trim().toLowerCase();
  }

  /** Keeps the first entry per key; a later duplicate's logo survives if the kept one has none. */
  private dedupeNamed<T extends { name: string; logo?: string }>(list: T[], keyOf: (item: T) => string = item => this.normalizeKey(item.name)): T[] {
    const seen = new Map<string, T>();
    for (const item of list) {
      const key = keyOf(item);
      const kept = seen.get(key);
      if (!kept) seen.set(key, item);
      else if (!kept.logo && item.logo) kept.logo = item.logo;
    }
    return [...seen.values()];
  }

  /** One entry per name across the four catalog lists; also run after cloud pulls. */
  dedupeTaxonomy(): void {
    this.categories.update(list => this.dedupeNamed(list));
    this.subCategories.update(list => this.dedupeNamed(list, s => `${this.normalizeKey(s.parentCategory)}|${this.normalizeKey(s.name)}`));
    this.brands.update(list => this.dedupeNamed(list));
    this.productModels.update(list => this.dedupeNamed(list));
  }

  brandProductCount(name: string): number {
    const key = this.normalizeKey(name);
    return this.products().filter(p => this.normalizeKey(p.brand) === key).length;
  }

  categoryProductCount(name: string): number {
    const key = this.normalizeKey(name);
    return this.products().filter(p => this.normalizeKey(p.category) === key).length;
  }

  subCategoryProductCount(name: string): number {
    const key = this.normalizeKey(name);
    return this.products().filter(p => this.normalizeKey(p.subCategory) === key).length;
  }

  modelProductCount(name: string): number {
    return this.products().filter(p => hasProductModel(p.model, name)).length;
  }

  variationProductCount(id: number): number {
    return this.products().reduce(
      (total, p) => total + (p.variants?.filter(v => v.variationId === id).length || 0),
      0
    );
  }

  categorySubCategoryCount(name: string): number {
    const key = this.normalizeKey(name);
    return this.subCategories().filter(sc => this.normalizeKey(sc.parentCategory) === key).length;
  }

  updateBrand(id: number, patch: Partial<Omit<Brand, 'id'>>) {
    const current = this.brands().find(b => b.id === id);
    if (!current) return;

    this.brands.update(list => list.map(b => b.id === id ? { ...b, ...patch } : b));

    if (patch.name && this.normalizeKey(patch.name) !== this.normalizeKey(current.name)) {
      const oldKey = this.normalizeKey(current.name);
      const nextName = patch.name;
      this.products.update(list =>
        list.map(p => this.normalizeKey(p.brand) === oldKey ? { ...p, brand: nextName } : p)
      );
    }
  }

  updateCategory(id: number, patch: Partial<Omit<Category, 'id'>>) {
    const current = this.categories().find(c => c.id === id);
    if (!current) return;

    this.categories.update(list => list.map(c => c.id === id ? { ...c, ...patch } : c));

    if (patch.name && this.normalizeKey(patch.name) !== this.normalizeKey(current.name)) {
      const oldKey = this.normalizeKey(current.name);
      const nextName = patch.name;
      this.products.update(list =>
        list.map(p => this.normalizeKey(p.category) === oldKey ? { ...p, category: nextName } : p)
      );
      this.subCategories.update(list =>
        list.map(sc => this.normalizeKey(sc.parentCategory) === oldKey ? { ...sc, parentCategory: nextName } : sc)
      );
    }
  }

  updateSubCategory(id: number, patch: Partial<Omit<SubCategory, 'id'>>) {
    const current = this.subCategories().find(sc => sc.id === id);
    if (!current) return;

    this.subCategories.update(list => list.map(sc => sc.id === id ? { ...sc, ...patch } : sc));

    if (patch.name && this.normalizeKey(patch.name) !== this.normalizeKey(current.name)) {
      const oldKey = this.normalizeKey(current.name);
      const nextName = patch.name;
      this.products.update(list =>
        list.map(p => this.normalizeKey(p.subCategory) === oldKey ? { ...p, subCategory: nextName } : p)
      );
    }
  }

  updateProductModel(id: number, patch: Partial<Omit<ProductModel, 'id'>>) {
    const current = this.productModels().find(m => m.id === id);
    if (!current) return;

    this.productModels.update(list => list.map(m => m.id === id ? { ...m, ...patch } : m));

    if (patch.name && this.normalizeKey(patch.name) !== this.normalizeKey(current.name)) {
      const nextName = patch.name;
      this.products.update(list =>
        list.map(p => hasProductModel(p.model, current.name)
          ? { ...p, model: replaceProductModel(p.model, current.name, nextName) }
          : p)
      );
    }
  }

  updateVariation(id: number, patch: Partial<Omit<Variation, 'id'>>) {
    const current = this.variations().find(v => v.id === id);
    if (!current) return;

    this.variations.update(list => list.map(v => v.id === id ? { ...v, ...patch } : v));

    if (patch.name && this.normalizeKey(patch.name) !== this.normalizeKey(current.name)) {
      const nextName = patch.name;
      this.products.update(list =>
        list.map(p => p.variants?.length
          ? {
              ...p,
              variants: p.variants.map(v => v.variationId === id ? { ...v, variationName: nextName } : v)
            }
          : p)
      );
    }
  }

  /**
   * One party can trade on both books. Legacy records only have type/total/paid/due,
   * so their single balance is moved onto the side that matches the stored type.
   * The legacy columns stay as a combined mirror for screens not yet side-aware.
   */
  /** Older saves may hold option objects; warehouses must stay plain names. */
  private normalizeWarehouses(list: unknown[]): string[] {
    const names: string[] = [];
    for (const item of list) {
      const raw = typeof item === 'string'
        ? item
        : item && typeof item === 'object' && 'value' in item
          ? (item as { value: unknown }).value
          : '';
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (name && !names.some(existing => existing.toLowerCase() === name.toLowerCase())) {
        names.push(name);
      }
    }
    return names.length ? names : ['SM Warehouse'];
  }

  private normalizeParty(party: Party): Party {
    const roles = partyRoles(party);
    const hasSide = party.salesTotal != null || party.salesPaid != null || party.salesDue != null
      || party.purchaseTotal != null || party.purchasePaid != null || party.purchaseDue != null;
    const legacy: PartySideAccount = {
      total: partyRound(party.total),
      paid: partyRound(party.paid),
      due: partyRound(party.due),
      advance: partyRound(party.advance)
    };
    const empty: PartySideAccount = { total: 0, paid: 0, due: 0, advance: 0 };
    let sales: PartySideAccount;
    let purchase: PartySideAccount;
    if (hasSide) {
      sales = {
        total: partyRound(party.salesTotal),
        paid: partyRound(party.salesPaid),
        due: partyRound(party.salesDue),
        advance: partyRound(party.salesAdvance)
      };
      purchase = {
        total: partyRound(party.purchaseTotal),
        paid: partyRound(party.purchasePaid),
        due: partyRound(party.purchaseDue),
        advance: partyRound(party.purchaseAdvance)
      };
    } else if (party.type === 'Supplier') {
      sales = { ...empty };
      purchase = legacy;
    } else {
      sales = legacy;
      purchase = { ...empty };
    }
    // A counter sale never owns a book, so stray dues/advances saved under the
    // walk-in label (old credit notes, opening balances) are cleared on load.
    const walkIn = isWalkInCustomer(party.name);
    // Round-D reminders stored only a date; they become a promise for the due
    // of that day so older saves survive the move to the reminder board.
    const dueTotal = partyRound(sales.due + purchase.due);
    const legacyPromise: PaymentPromise | undefined = party.paymentPromise
      ?? (party.paymentReminderDate
        ? {
            date: party.paymentReminderDate,
            amount: dueTotal,
            received: 0,
            createdAt: `${party.paymentReminderDate}T00:00:00.000Z`,
            history: [{ at: `${party.paymentReminderDate}T00:00:00.000Z`, kind: 'set', date: party.paymentReminderDate, amount: dueTotal }]
          }
        : undefined);
    return {
      ...party,
      roles,
      salesTotal: sales.total,
      salesPaid: sales.paid,
      salesDue: walkIn ? 0 : sales.due,
      salesAdvance: walkIn ? 0 : sales.advance,
      purchaseTotal: purchase.total,
      purchasePaid: purchase.paid,
      purchaseDue: walkIn ? 0 : purchase.due,
      purchaseAdvance: walkIn ? 0 : purchase.advance,
      paymentPromise: walkIn ? undefined : legacyPromise,
      total: partyRound(sales.total + purchase.total),
      paid: partyRound(sales.paid + purchase.paid),
      due: walkIn ? 0 : partyRound(sales.due + purchase.due),
      advance: walkIn ? 0 : partyRound(sales.advance + purchase.advance)
    };
  }

  private sideAccount(party: Party, side: PartySide): PartySideAccount {
    return side === 'purchase' ? purchaseAccountOf(party) : salesAccountOf(party);
  }

  /**
   * Adds deltas to one side of a party's books and refreshes the legacy mirror.
   * `ensureRole` records the role that the transaction proves the party holds.
   */
  private patchPartyAccount(
    party: Party,
    side: PartySide,
    delta: Partial<PartySideAccount>,
    ensureRole?: PartyType
  ): Party {
    const sales = this.sideAccount(party, 'sales');
    const purchase = this.sideAccount(party, 'purchase');
    const target = side === 'sales' ? { ...sales } : { ...purchase };
    for (const key of ['total', 'paid', 'due', 'advance'] as const) {
      const change = delta[key];
      if (change == null) continue;
      target[key] = partyRound(target[key] + change);
      if (key === 'advance' && target[key] < 0) target[key] = 0;
    }
    const nextSales = side === 'sales' ? target : sales;
    const nextPurchase = side === 'purchase' ? target : purchase;
    const roles = ensureRole && !hasPartyRole({ ...party, roles: partyRoles(party) }, ensureRole)
      ? [...partyRoles(party), ensureRole]
      : partyRoles(party);
    return {
      ...party,
      roles,
      salesTotal: nextSales.total,
      salesPaid: nextSales.paid,
      salesDue: nextSales.due,
      salesAdvance: nextSales.advance,
      purchaseTotal: nextPurchase.total,
      purchasePaid: nextPurchase.paid,
      purchaseDue: nextPurchase.due,
      purchaseAdvance: nextPurchase.advance,
      total: partyRound(nextSales.total + nextPurchase.total),
      paid: partyRound(nextSales.paid + nextPurchase.paid),
      due: partyRound(nextSales.due + nextPurchase.due),
      advance: partyRound(nextSales.advance + nextPurchase.advance)
    };
  }

  addParty(party: Omit<Party, 'id'>) {
    const id = this.newId();
    const record = this.normalizeParty({ ...party, id } as Party);
    this.parties.update(list => [record, ...list]);
    this.saveParties();
    return record;
  }

  updateParty(updatedParty: Party) {
    // Resolve against the old names before a rename can detach legacy vouchers.
    this.sales.update(rows => rows.map(r => ({ ...r, partyId: r.partyId ?? this.partyForReference(undefined, r.customerName)?.id })));
    this.purchases.update(rows => rows.map(r => ({ ...r, partyId: r.partyId ?? this.partyForReference(undefined, r.supplierName)?.id })));
    this.salesReturns.update(rows => rows.map(r => ({ ...r, partyId: r.partyId ?? this.partyForReference(undefined, r.customerName)?.id })));
    this.recycleBin.update(rows => rows.map(entry => {
      if (!['sm_sales_v1', 'sm_purchases_v1', 'sm_sales_returns_v1'].includes(entry.collection)) return entry;
      const r = entry.payload as Sale & Purchase;
      return { ...entry, payload: { ...r, partyId: r.partyId ?? this.partyForReference(undefined, r.customerName ?? r.supplierName)?.id } };
    }));
    this.saveSales();
    this.savePurchases();
    this.parties.update(list => list.map(p => p.id === updatedParty.id
      ? this.normalizeParty({ ...p, ...updatedParty })
      : p));
    this.saveParties();
  }

  deleteParty(id: number) {
    this.archive('sm_parties_v1', 'পার্টি', this.parties().find(p => p.id === id));
    this.parties.update(list => list.filter(p => p.id !== id));
    this.saveParties();
  }

  /** IDs win; legacy names may resolve only when unique. Never fan out a posting. */
  partyForReference(id: number | undefined, name: string): Party | undefined {
    if (id != null) {
      const party = this.parties().find(p => p.id === id);
      return party && !isWalkInCustomer(party.name) ? party : undefined;
    }
    if (isWalkInCustomer(name)) return undefined;
    const matches = this.parties().filter(p => this.normalizeKey(p.name) === this.normalizeKey(name));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** The party that already owns this mobile number, if any — one number, one party id. */
  partyByPhone(phone: string | null | undefined, exceptId?: number | null): Party | undefined {
    const key = partyPhoneKey(phone);
    if (!key) return undefined;
    return this.parties().find(p =>
      p.id !== exceptId && partyPhones(p).some(value => partyPhoneKey(value) === key));
  }

  private inventoryDeltas(changes: InventoryChange[]): Map<number, { quantity: number; variants: Map<number, number> }> {
    const deltas = new Map<number, { quantity: number; variants: Map<number, number> }>();
    for (const [kind, record, direction] of changes) {
      const active = kind === 'sale' ? record.status === 'Completed'
        : kind === 'purchase' ? record.status === 'Received'
        : kind === 'credit' ? record.status === 'Posted' && (record as SalesReturn).restock
        : this.supplierReturnPosts(record.status);
      if (!active) continue;
      const sign = direction * (kind === 'sale' || kind === 'supplier' ? -1 : 1);
      const items: { productId?: number; productName: string; variantId?: number; quantity: number; unitFactor?: number }[] = [...(record.items || [])];
      if (kind === 'sale') {
        const claim = (record as Sale).warranty;
        if (claim && isWarrantyCompleted(claim.status) && Number(claim.replacementQty) > 0) {
          const product = this.products().find(p => claim.replacementProductId != null ? p.id === claim.replacementProductId : this.normalizeKey(p.name) === this.normalizeKey(claim.replacementProductName));
          if (product && !items.some(i => i.productId != null ? i.productId === product.id : i.productName === product.name)) {
            items.push({ productId: product.id, productName: product.name, quantity: Number(claim.replacementQty) });
          }
        }
      }
      for (const item of items) {
        // A line sold in an extra unit (2 কেজি) still moves stock in base units (2000 গ্রাম).
        const factor = Number(item.unitFactor) > 0 ? Number(item.unitFactor) : 1;
        const quantity = this.roundMoney(Number(item.quantity) * factor);
        if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Invalid inventory quantity.');
        const matches = this.products().filter(p => item.productId != null ? p.id === item.productId : p.name === item.productName);
        if (matches.length > 1) throw new Error(`Ambiguous product: ${item.productName}`);
        const product = matches[0];
        if (!product || product.type === 'service') continue;
        if (item.variantId != null && !product.variants?.some(v => v.id === item.variantId)) throw new Error(`Missing variant: ${item.productName}`);
        const delta = deltas.get(product.id) ?? { quantity: 0, variants: new Map<number, number>() };
        delta.quantity += sign * quantity;
        if (item.variantId != null) delta.variants.set(item.variantId, (delta.variants.get(item.variantId) || 0) + sign * quantity);
        deltas.set(product.id, delta);
      }
    }
    return deltas;
  }

  /** Check the aggregate net change, not intermediate reversal/reposting states. */
  private preflightInventory(...changes: InventoryChange[]): void {
    for (const [id, delta] of this.inventoryDeltas(changes)) {
      const product = this.products().find(p => p.id === id)!;
      if (delta.quantity < 0 && product.stock + delta.quantity < -0.0001) throw new Error(`Insufficient stock: ${product.name}`);
      for (const [variantId, quantity] of delta.variants) {
        const variant = product.variants!.find(v => v.id === variantId)!;
        if (quantity < 0 && variant.openingStock + quantity < -0.0001) throw new Error(`Insufficient variant stock: ${product.name} (${variant.variantValue})`);
      }
    }
  }

  private postInventory(...changes: InventoryChange[]): void {
    const deltas = this.inventoryDeltas(changes);
    this.products.update(list => list.map(p => {
      const delta = deltas.get(p.id);
      return !delta ? p : { ...p, stock: this.roundMoney(p.stock + delta.quantity),
        variants: p.variants?.map(v => ({ ...v, openingStock: this.roundMoney(v.openingStock + (delta.variants.get(v.id) || 0)) })) };
    }));
  }

  private invoiceDue(sale: Sale): Sale {
    const linked = this.salesReturns().filter(n => n.status === 'Posted' && n.invoiceNumber === sale.invoice
      && (n.partyId == null || sale.partyId == null || n.partyId === sale.partyId)).reduce((sum, n) => sum + n.amount, 0);
    const due = this.roundMoney(sale.total - sale.paid - this.saleCredits(sale) - linked);
    return { ...sale, due, paymentStatus: due <= 0 ? 'Paid' : sale.paid > 0 ? 'Partially Paid' : 'Unpaid' };
  }

  addSale(sale: Omit<Sale, 'id'>): Sale {
    const id = this.newId();
    const record: Sale = {
      ...sale,
      id,
      shareKey: this.newShareKey(),
      warranty: sale.warranty ? { ...sale.warranty } : undefined
    };
    record.partyId = this.partyForReference(record.partyId, record.customerName)?.id ?? record.partyId;
    record.invoice = this.freshSaleInvoice(record.invoice);
    this.preflightInventory(['sale', record, 1]);
    this.syncSaleWarranty(record);
    Object.assign(record, this.invoiceDue(record));
    this.sales.update(list => [record, ...list]);
    this.saveSales();
    this.postSale(record, 1);
    this.syncSaleBatteryVoucher(record);
    return this.sales().find(s => s.id === id) ?? record;
  }

  updateSale(id: number, sale: Omit<Sale, 'id'>): Sale {
    const previous = this.sales().find(s => s.id === id);
    if (!previous) throw new Error('Sale not found.');
    const record: Sale = {
      ...sale,
      id,
      shareKey: previous.shareKey,
      partyId: sale.partyId ?? (sale.customerName === previous.customerName ? previous.partyId : undefined),
      batteryVoucherId: previous?.batteryVoucherId,
      warrantyReceiptId: previous?.warrantyReceiptId,
      warranty: sale.warranty ? { ...sale.warranty } : undefined
    };
    record.partyId = this.partyForReference(record.partyId, record.customerName)?.id ?? record.partyId;
    this.preflightInventory(['sale', previous, -1], ['sale', record, 1]);
    this.syncSaleWarranty(record, previous);
    Object.assign(record, this.invoiceDue(record));
    this.sales.update(list => list.map(s => s.id === id ? record : s));
    this.saveSales();
    if (previous) this.postSale(previous, -1);
    this.postSale(record, 1);
    this.syncSaleBatteryVoucher(record, previous);
    return this.sales().find(s => s.id === id) ?? record;
  }

  updateSaleStatus(id: number, status: Sale['status']) {
    const previous = this.sales().find(s => s.id === id);
    if (!previous || previous.status === status) return;
    const record: Sale = { ...previous, status };
    this.preflightInventory(['sale', previous, -1], ['sale', record, 1]);
    this.sales.update(list => list.map(s => s.id === id ? record : s));
    this.saveSales();
    this.postSale(previous, -1);
    this.postSale(record, 1);
    // The trade-in voucher belongs to the sale: cancelling drops it, and
    // reactivating recreates it from the saved battery rows.
    if (status === 'Cancelled' || previous.status === 'Cancelled') {
      this.syncSaleBatteryVoucher(record, previous);
    }
  }

  /**
   * A sale only affects stock while it is Completed, and only affects the
   * party books while it is not Cancelled. Reversing with direction -1 keeps
   * edits, deletes and status changes symmetrical.
   */
  private postSale(sale: Sale, direction: 1 | -1) {
    if (!sale || sale.status === 'Cancelled') return;
    this.postSaleParty(sale, direction);
    if (sale.status === 'Completed') this.postSaleStock(sale, direction);
  }

  private postSaleParty(sale: Sale, direction: 1 | -1) {
    const party = this.partyForReference(sale.partyId, sale.customerName);
    if (!party) return;
    const total = this.roundMoney(sale.total || 0);
    const paid = this.roundMoney(sale.paid || 0);
    const credits = this.saleCredits(sale);
    // A sale proves the party trades on the sales book, so the customer role is
    // added to suppliers/corporates that were only set up for one side before.
    this.parties.update(list => list.map(p => p.id === party.id
      ? this.patchPartyAccount(p, 'sales', {
          total: direction * total,
          paid: direction * paid,
          // Old-battery trade-ins and goods returned on the same voucher settle
          // part of the bill, so the party balance must drop by those credits too.
          due: direction * (total - paid - credits)
        }, 'Customer')
      : p));
    this.saveParties();
  }

  /** Credits inside a voucher (old battery + returned goods) that settle the bill. */
  saleCredits(sale: Sale): number {
    const battery = Number(sale.batteryAdjustmentTotal)
      || (sale.batteryAdjustments ?? []).reduce((sum, b) => sum + (Number(b.total) || 0), 0);
    const returned = (sale.returns ?? []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    return this.roundMoney(battery + returned);
  }

  /**
   * Signed effect of every posted document on one book: what the due would be
   * if the party had started from zero. Mirrors the party ledger rows exactly.
   */
  partyBookMovement(party: Party, side: PartySide): number {
    const key = (party.name || '').trim().toLowerCase();
    const same = (name?: string) => key.length > 0 && (name || '').trim().toLowerCase() === key;
    const money = (value?: number | string | null) => this.roundMoney(Number(value) || 0);
    let movement = 0;
    if (side === 'sales') {
      for (const s of this.sales()) {
        if (s.status === 'Cancelled' || !same(s.customerName)) continue;
        movement += money(s.total) - money(s.paid) - money(this.saleCredits(s));
      }
      for (const r of this.salesReturns()) {
        if (r.status === 'Posted' && same(r.customerName)) movement -= money(r.amount);
      }
    } else {
      for (const p of this.purchases()) {
        if (!same(p.supplierName)) continue;
        movement += money(p.total) - money(p.paid);
      }
      for (const r of this.supplierReturns()) {
        if (r.partyId === party.id && this.supplierReturnPosts(r.status)) movement -= money(r.amount);
      }
    }
    for (const pay of this.payments()) {
      const paySide: PartySide = pay.partyType === 'Supplier' ? 'purchase' : pay.partyType === 'Customer' ? 'sales' : side;
      if (paySide !== side) continue;
      if (pay.partyId !== party.id && !same(pay.partyName)) continue;
      movement -= money(pay.amount) + money(pay.discount) - money(pay.advance);
    }
    return this.roundMoney(movement);
  }

  /**
   * The opening balance the books actually carry: due minus document movement.
   * A correction must replace this figure, not the stored column, because
   * imports and older edits baked part of the opening into the due directly.
   */
  partyOpeningBalance(party: Party, side: PartySide): number {
    return this.roundMoney(accountOf(party, side).due - this.partyBookMovement(party, side));
  }

  /**
   * The claim entered on Add Sale/POS is the same document as the warranty
   * receipt, so one save feeds the intake list, register and received pool.
   * The receipt owns the claim number; the sale keeps a copy for printing.
   */
  private syncSaleWarranty(record: Sale, previous?: Sale): void {
    const claim = record.warranty;
    const linkedId = record.warrantyReceiptId ?? previous?.warrantyReceiptId;
    const existing = linkedId != null
      ? this.warrantyReceipts().find(r => r.id === linkedId)
      : previous
        ? this.warrantyReceipts().find(r => r.saleId === previous.id)
        : undefined;

    if (!claim) {
      if (existing) {
        if (existing.replacementClaimNo) throw new Error('Cannot remove a settled warranty claim.');
        const result = this.deleteWarrantyReceipt(existing.id);
        if (!result.ok) throw new Error(result.error || 'Warranty removal rejected.');
      }
      record.warrantyReceiptId = undefined;
      return;
    }

    const patch = this.saleWarrantyReceipt(record, claim);
    if (existing) {
      const result = this.updateWarrantyReceipt(existing.id, patch);
      if (!result.ok) throw new Error(result.error || 'Warranty update rejected.');
      record.warrantyReceiptId = existing.id;
      claim.claimNo = existing.claimNo;
      return;
    }

    const receipt = this.recordWarrantyReceipt({ ...patch, saleId: record.id });
    record.warrantyReceiptId = receipt.id;
    claim.claimNo = receipt.claimNo;
  }

  private saleWarrantyReceipt(
    sale: Sale,
    claim: WarrantyClaimInfo
  ): Omit<WarrantyReceipt, 'id' | 'claimNo' | 'createdAt' | 'updatedAt' | 'replacementClaimNo' | 'replacedAt'> {
    const battery = (claim.battery || '').trim();
    const product = claim.productId != null
      ? this.products().find(p => p.id === claim.productId)
      : this.products().find(p => (p.name || '').trim().toLowerCase() === battery.toLowerCase());
    const original = claim.originalInvoice
      ? this.sales().find(s => (s.invoice || '').trim().toLowerCase() === claim.originalInvoice.trim().toLowerCase())
      : undefined;
    const status = (claim.status || '').trim()
      || this.warrantySettings().receiptStatuses[0]
      || 'গ্রহণ করা হয়েছে';
    const noteParts = [
      claim.receiptNo ? `রসিদ: ${claim.receiptNo}` : '',
      claim.deliveryNo ? `ডেলিভারি: ${claim.deliveryNo}` : '',
      claim.newSerial ? `নতুন সিরিয়াল: ${claim.newSerial}` : ''
    ].filter(Boolean);
    return {
      date: isoDay(claim.receiveDate) || isoDay(sale.date) || localDateIso(),
      customerName: (sale.customerName || '').trim(),
      phone: (sale.mobile || '').trim(),
      invoiceNumber: (claim.originalInvoice || sale.invoice || '').trim(),
      saleId: sale.id,
      productId: product?.id ?? claim.productId,
      productName: battery || product?.name || '',
      serialNumber: (claim.oldSerial || '').trim(),
      quantity: parseWarrantyQuantity(claim.quantity) || 1,
      unit: product?.unit || 'pcs',
      warrantyStart: isoDay(original?.date) || undefined,
      warrantyDays: Math.round(Number(claim.warrantyDays ?? product?.warrantyDays) || 0) || undefined,
      condition: '',
      reason: (claim.notes || '').trim() || 'ওয়ারেন্টি পণ্য গ্রহণ',
      expectedDate: isoDay(claim.replacementDate) || undefined,
      status,
      stockIn: !isWarrantyCancelled(status),
      notes: noteParts.join(' · ') || undefined,
      handledBy: (sale.preparedBy || '').trim() || undefined
    };
  }

  /**
   * Sold lines leave stock, and a completed warranty claim takes its replacement
   * out too. Products already billed on the voucher are skipped for the claim so
   * the same piece cannot be deducted twice.
   */
  private postSaleStock(sale: Sale, direction: 1 | -1) {
    this.postInventory(['sale', sale, direction]);
  }

  nextPurchaseInvoice(): string {
    return `PUR-${this.nextPurchaseSerial()}`;
  }

  /**
   * Purchase numbers restart at PUR-3001 and follow only that four-digit book.
   * The cloud serial blocks drift ahead and older imports used five-digit
   * numbers, so both are ignored; an already used number is skipped.
   */
  private nextPurchaseSerial(): number {
    const used = new Set(this.purchases().map(p => (p.invoice || '').trim().toUpperCase()));
    let next = PURCHASE_SERIAL_START + 1;
    for (const purchase of this.purchases()) {
      const match = /^PUR-(\d{4})$/.exec((purchase.invoice || '').trim());
      if (match) next = Math.max(next, Number(match[1]) + 1);
    }
    while (used.has(`PUR-${next}`)) next++;
    return next;
  }

  nextSupplierReturnNo(): string {
    return this.nextDocNo('SRET', this.supplierReturns().map(r => r.returnNo));
  }

  nextCreditNoteNo(): string {
    return this.nextDocNo('CRN', this.salesReturns().map(x => x.creditNoteNo));
  }

  recordPurchase(purchase: Omit<Purchase, 'id'>): Purchase {
    const id = this.newId();
    const record: Purchase = { ...purchase, id, shareKey: this.newShareKey(), partyId: this.partyForReference(purchase.partyId, purchase.supplierName)?.id ?? purchase.partyId };
    this.preflightInventory(['purchase', record, 1]);
    this.purchases.update(list => [record, ...list]);
    this.savePurchases();
    this.postPurchaseStock(record, 1);
    this.syncPurchaseCost(record);
    this.postPurchaseParty(record, 1);
    return record;
  }

  updatePurchase(id: number, purchase: Omit<Purchase, 'id'>) {
    const previous = this.purchases().find(p => p.id === id);
    if (!previous) throw new Error('Purchase not found.');
    const partyId = purchase.partyId ?? (purchase.supplierName === previous.supplierName ? previous.partyId : undefined);
    const record: Purchase = { ...purchase, id, shareKey: previous.shareKey, partyId: this.partyForReference(partyId, purchase.supplierName)?.id ?? partyId };
    this.preflightInventory(['purchase', previous, -1], ['purchase', record, 1]);
    this.purchases.update(list => list.map(p => p.id === id ? record : p));
    this.savePurchases();
    if (previous) this.postPurchaseStock(previous, -1);
    this.postPurchaseStock(record, 1);
    this.syncPurchaseCost(record);
    if (previous) this.postPurchaseParty(previous, -1);
    this.postPurchaseParty(record, 1);
  }

  deletePurchase(id: number) {
    const previous = this.purchases().find(p => p.id === id);
    if (!previous) return;
    this.preflightInventory(['purchase', previous, -1]);
    this.archive('sm_purchases_v1', 'ক্রয়', previous);
    this.purchases.update(list => list.filter(p => p.id !== id));
    this.savePurchases();
    this.postPurchaseStock(previous, -1);
    this.postPurchaseParty(previous, -1);
  }

  /** Only received purchases hold stock; reversing an edit or delete puts the quantity back. */
  private postPurchaseStock(purchase: Purchase, direction: 1 | -1) {
    this.postInventory(['purchase', purchase, direction]);
  }

  /**
   * A received purchase makes the bought rate the product's cost, so margins,
   * stock valuation and the products list follow the latest buying price.
   */
  private syncPurchaseCost(purchase: Purchase) {
    if (purchase.status !== 'Received') return;
    const lines = (purchase.items ?? []).filter(line => line.purchasePrice > 0);
    if (!lines.length) return;
    this.products.update(list => list.map(product => {
      const hits = lines.filter(line => line.productId != null
        ? line.productId === product.id
        : line.productName === product.name);
      if (!hits.length) return product;
      if (product.type === 'variant') {
        let changed = false;
        const variants = product.variants?.map(variant => {
          const line = hits.find(hit => hit.variantId === variant.id);
          if (!line || line.purchasePrice === variant.purchasePrice) return variant;
          changed = true;
          return { ...variant, purchasePrice: line.purchasePrice };
        });
        if (!changed) return product;
        const quoted = (variants ?? []).map(variant => variant.purchasePrice).filter(price => price > 0);
        return { ...product, variants, purchasePrice: quoted.length ? Math.min(...quoted) : product.purchasePrice };
      }
      const line = hits.find(hit => hit.variantId == null) ?? hits[0];
      if (line.purchasePrice === product.purchasePrice) return product;
      return { ...product, purchasePrice: line.purchasePrice };
    }));
  }

  /**
   * Physical-count reconciliation: the owner types what is actually on the
   * shelf and the difference is booked against the product without touching
   * any invoice. Variant products are counted per variant so the parent total
   * stays the sum of its variants.
   */
  adjustProductStock(
    productId: number,
    counted: { quantity?: number; variants?: Record<number, number> },
    details: { reason: StockAdjustmentReason; note?: string; user?: string }
  ): { ok: boolean; error?: string; adjustment?: StockAdjustment } {
    const product = this.products().find(p => p.id === productId);
    if (!product) return { ok: false, error: 'missing' };
    if (product.type === 'service') return { ok: false, error: 'service' };
    const reasons: StockAdjustmentReason[] = ['found', 'count', 'damage', 'return', 'other'];
    if (!reasons.includes(details.reason)) return { ok: false, error: 'reason' };

    const previousStock = this.roundMoney(product.stock);
    let nextStock = previousStock;
    let nextProduct: Product;
    const variantChanges: StockAdjustment['variants'] = [];

    if (product.type === 'variant') {
      const targets = product.variants ?? [];
      if (!targets.length) return { ok: false, error: 'variant' };
      const countedMap = counted.variants ?? {};
      const nextById = new Map<number, number>();
      for (const variant of targets) {
        const raw = countedMap[variant.id];
        if (raw === undefined) continue;
        const rawQty = Number(raw);
        if (!Number.isFinite(rawQty) || rawQty < 0) return { ok: false, error: 'quantity' };
        const next = this.roundMoney(rawQty);
        const previous = this.roundMoney(variant.openingStock);
        if (next === previous) continue;
        nextById.set(variant.id, next);
        variantChanges.push({ variantId: variant.id, variantValue: variant.variantValue, previous, next });
      }
      if (!variantChanges.length) return { ok: false, error: 'nochange' };
      const delta = this.roundMoney(
        variantChanges.reduce((sum, change) => sum + (change.next - change.previous), 0)
      );
      nextStock = this.roundMoney(previousStock + delta);
      if (nextStock < 0) return { ok: false, error: 'negative' };
      nextProduct = {
        ...product,
        stock: nextStock,
        variants: product.variants!.map(v => nextById.has(v.id) ? { ...v, openingStock: nextById.get(v.id)! } : v)
      };
    } else {
      const rawQty = Number(counted.quantity);
      if (!Number.isFinite(rawQty) || rawQty < 0) return { ok: false, error: 'quantity' };
      const next = this.roundMoney(rawQty);
      if (next === previousStock) return { ok: false, error: 'nochange' };
      nextStock = next;
      nextProduct = { ...product, stock: next };
    }

    const adjustment: StockAdjustment = {
      id: this.newId(),
      date: localDateIso(),
      productId: product.id,
      productName: product.name,
      code: product.code,
      unit: product.unit,
      previousStock,
      newStock: nextStock,
      delta: this.roundMoney(nextStock - previousStock),
      variants: variantChanges,
      reason: details.reason,
      note: (details.note || '').trim() || undefined,
      user: (details.user || '').trim() || undefined,
      createdAt: new Date().toISOString()
    };

    this.products.update(list => list.map(p => p.id === product.id ? nextProduct : p));
    this.stockAdjustments.update(list => [adjustment, ...list]);
    this.saveStockAdjustments();
    return { ok: true, adjustment };
  }

  /**
   * A purchase bill is a payable to the supplier, so it moves the same three
   * ledger columns as a sale invoice. The party join uses the same name rule as
   * the ledger statement, and -1 keeps edits and deletes symmetrical.
   */
  private postPurchaseParty(purchase: Purchase, direction: 1 | -1) {
    const party = this.partyForReference(purchase.partyId, purchase.supplierName);
    if (!party) return;
    const total = this.roundMoney(purchase.total || 0);
    const paid = this.roundMoney(purchase.paid || 0);
    // Buying from a party also records that it can supply goods.
    this.parties.update(list => list.map(p => p.id === party.id
      ? this.patchPartyAccount(p, 'purchase', {
          total: direction * total,
          paid: direction * paid,
          due: direction * (total - paid)
        }, 'Supplier')
      : p));
    this.saveParties();
  }

  addWarranty(warranty: Omit<ProductWarranty, 'id'>): ProductWarranty {
    const id = this.newId();
    const record: ProductWarranty = { ...warranty, id };
    this.warranties.update(list => [record, ...list]);
    this.saveWarranties();
    return record;
  }

  updateWarranty(id: number, patch: Partial<ProductWarranty>) {
    this.warranties.update(list => list.map(w => w.id === id ? { ...w, ...patch, id } : w));
    this.saveWarranties();
  }

  deleteWarranty(id: number) {
    const previous = this.warranties().find(w => w.id === id);
    if (previous) this.archive('sm_warranties_v1', 'ওয়ারেন্টি', previous);
    this.warranties.update(list => list.filter(w => w.id !== id));
    this.saveWarranties();
  }

  // ------------------------------------------------------------------
  // Advanced warranty: intake and replacement are separate documents, and
  // their stock lives in two separate pools (received / replacement).
  // ------------------------------------------------------------------

  readonly warrantyClaimStats = computed(() => {
    const today = localDateIso();
    const receipts = this.warrantyReceipts();
    const replacements = this.warrantyReplacements();
    return {
      receipts: receipts.length,
      open: this.openWarrantyReceipts().length,
      todayReceipts: receipts.filter(r => (r.date || '') === today).length,
      replacements: replacements.length,
      todayReplacements: replacements.filter(r => (r.date || '') === today).length,
      productsWithStock: this.warrantyStockRows().filter(r => r.received !== 0 || r.replacement !== 0).length,
      cost: this.roundMoney(replacements.filter(r => r.stage === 'completed').reduce((sum, r) => sum + (Number(r.cost) || 0), 0))
    };
  });

  private warrantyNumbers(records: { claimNo: string }[], prefix: string): string[] {
    const clean = (prefix || '').trim();
    const archived = this.recycleBin()
      .filter(entry => entry.collection === 'sm_warranty_receipts_v1' || entry.collection === 'sm_warranty_replacements_v1')
      .map(entry => entry.payload as WarrantyReceipt | WarrantyReplacement);
    return [...records, ...archived]
      .map(record => record.claimNo)
      .filter((no): no is string => !!no && (!clean || no.startsWith(`${clean}-`)));
  }

  peekWarrantyReceiptNo(): string {
    const settings = this.warrantySettings();
    return this.peekDocNo(settings.receiptPrefix, this.warrantyNumbers(this.warrantyReceipts(), settings.receiptPrefix), settings.startNumber - 1);
  }

  peekWarrantyReplacementNo(): string {
    const settings = this.warrantySettings();
    return this.peekDocNo(settings.replacementPrefix, this.warrantyNumbers(this.warrantyReplacements(), settings.replacementPrefix), settings.startNumber - 1);
  }

  private validateWarrantyReceipt(input: Pick<WarrantyReceipt, 'quantity' | 'serialNumber' | 'status'>, excludeId?: number): string | undefined {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) return 'Invalid warranty quantity.';
    const serial = (input.serialNumber || '').trim().toLowerCase();
    if (serial && !isWarrantyCancelled(input.status) && !isWarrantyCompleted(input.status)
      && this.openWarrantyReceipts().some(r => r.id !== excludeId && (r.serialNumber || '').trim().toLowerCase() === serial)) {
      return 'An open warranty claim already exists for this serial.';
    }
    return undefined;
  }

  recordWarrantyReceipt(input: Omit<WarrantyReceipt, 'id' | 'claimNo' | 'createdAt' | 'updatedAt' | 'replacementClaimNo' | 'replacedAt'>): WarrantyReceipt {
    const error = this.validateWarrantyReceipt(input);
    if (error) throw new Error(error);
    const settings = this.warrantySettings();
    const id = this.newId();
    const record: WarrantyReceipt = {
      ...input,
      id,
      claimNo: this.nextDocNo(settings.receiptPrefix, this.warrantyNumbers(this.warrantyReceipts(), settings.receiptPrefix), settings.startNumber - 1),
      createdAt: new Date().toISOString()
    };
    this.warrantyReceipts.update(list => [record, ...list]);
    this.postWarrantyReceiptStock(record, 1);
    this.saveWarrantyReceipts();
    return record;
  }

  updateWarrantyReceipt(id: number, patch: Partial<WarrantyReceipt>): { ok: boolean; error?: string; record?: WarrantyReceipt } {
    const old = this.warrantyReceipts().find(r => r.id === id);
    if (!old) return { ok: false, error: 'missing' };
    const next: WarrantyReceipt = { ...old, ...patch, id, claimNo: old.claimNo, updatedAt: new Date().toISOString() };
    const error = this.validateWarrantyReceipt(next, id);
    if (error) return { ok: false, error };
    const stockChanged = old.quantity !== next.quantity || old.stockIn !== next.stockIn
      || old.productId !== next.productId || old.productName !== next.productName
      || old.serialNumber !== next.serialNumber || old.unit !== next.unit || old.date !== next.date;
    // A settled claim's status label is owned by the replacement voucher; editing
    // it here would make the intake list contradict the register.
    if (old.replacementClaimNo && (stockChanged || old.status !== next.status)) return { ok: false, error: 'settled' };
    if (stockChanged && old.stockIn && !this.warrantySettings().allowNegativeStock) {
      const same = this.warrantyStockKey(old.productId, old.productName, old.unit) === this.warrantyStockKey(next.productId, next.productName, next.unit);
      const remaining = this.warrantyStockOf(old.productId, old.productName, old.unit).received - old.quantity + (same && next.stockIn ? next.quantity : 0);
      if (remaining < -0.0001) return { ok: false, error: 'received-shortage' };
    }
    if (stockChanged) {
      this.postWarrantyReceiptStock(old, -1);
      this.postWarrantyReceiptStock(next, 1);
    }
    this.warrantyReceipts.update(list => list.map(r => (r.id === id ? next : r)));
    this.saveWarrantyReceipts();
    return { ok: true, record: next };
  }

  deleteWarrantyReceipt(id: number): { ok: boolean; error?: string } {
    const previous = this.warrantyReceipts().find(r => r.id === id);
    if (!previous) return { ok: false, error: 'missing' };
    // Cancelled vouchers post nothing, so they must not keep a claim alive.
    if (this.warrantyReplacements().some(r => r.receiptId === id
      && (r.stage ? r.stage !== 'cancelled' : !isWarrantyCancelled(r.status)))) return { ok: false, error: 'replaced' };
    if (previous.stockIn && !this.warrantySettings().allowNegativeStock
      && this.warrantyStockOf(previous.productId, previous.productName, previous.unit).received < previous.quantity) {
      return { ok: false, error: 'received-shortage' };
    }
    this.postWarrantyReceiptStock(previous, -1);
    this.archive('sm_warranty_receipts_v1', 'ওয়ারেন্টি গ্রহণ', previous);
    this.warrantyReceipts.update(list => list.filter(r => r.id !== id));
    this.saveWarrantyReceipts();
    // The claim lived on the sale too; leaving it behind would keep showing a
    // deleted claim in the warranty register.
    if (previous.saleId != null) {
      this.sales.update(list => list.map(sale => sale.id === previous.saleId
        ? { ...sale, warrantyReceiptId: undefined, warranty: undefined }
        : sale));
      this.saveSales();
    }
    return { ok: true };
  }

  recordWarrantyReplacement(input: Omit<WarrantyReplacement, 'id' | 'claimNo' | 'createdAt' | 'updatedAt' | 'receiptPrevStatus'>): { ok: boolean; error?: string; record?: WarrantyReplacement } {
    const error = this.validateWarrantyReplacement(input);
    if (error) return { ok: false, error };
    const settings = this.warrantySettings();
    const receipt = input.receiptId != null ? this.warrantyReceipts().find(r => r.id === input.receiptId) : undefined;
    const record: WarrantyReplacement = {
      ...input,
      id: this.newId(),
      claimNo: this.nextDocNo(settings.replacementPrefix, this.warrantyNumbers(this.warrantyReplacements(), settings.replacementPrefix), settings.startNumber - 1),
      receiptClaimNo: receipt?.claimNo ?? input.receiptClaimNo,
      receiptPrevStatus: receipt?.status,
      createdAt: new Date().toISOString()
    };
    this.warrantyReplacements.update(list => [record, ...list]);
    this.postWarrantyReplacement(record, 1);
    this.saveWarrantyReplacements();
    return { ok: true, record };
  }

  updateWarrantyReplacement(id: number, patch: Partial<WarrantyReplacement>): { ok: boolean; error?: string; record?: WarrantyReplacement } {
    const old = this.warrantyReplacements().find(r => r.id === id);
    if (!old) return { ok: false, error: 'missing' };
    const draft: WarrantyReplacement = { ...old, ...patch, id, claimNo: old.claimNo };
    const error = this.validateWarrantyReplacement(draft, id);
    if (error) return { ok: false, error };
    this.postWarrantyReplacement(old, -1);
    const receipt = draft.receiptId != null ? this.warrantyReceipts().find(r => r.id === draft.receiptId) : undefined;
    const next: WarrantyReplacement = {
      ...draft,
      receiptClaimNo: receipt?.claimNo ?? draft.receiptClaimNo,
      receiptPrevStatus: receipt?.status,
      updatedAt: new Date().toISOString()
    };
    this.warrantyReplacements.update(list => list.map(r => (r.id === id ? next : r)));
    this.postWarrantyReplacement(next, 1);
    this.saveWarrantyReplacements();
    return { ok: true, record: next };
  }

  deleteWarrantyReplacement(id: number): { ok: boolean; error?: string } {
    const previous = this.warrantyReplacements().find(r => r.id === id);
    if (!previous) return { ok: false, error: 'missing' };
    const error = this.validateWarrantyStockChange(previous);
    if (error) return { ok: false, error };
    this.postWarrantyReplacement(previous, -1);
    this.archive('sm_warranty_replacements_v1', 'ওয়ারেন্টি পরিবর্তন', previous);
    this.warrantyReplacements.update(list => list.filter(r => r.id !== id));
    this.saveWarrantyReplacements();
    return { ok: true };
  }

  adjustWarrantyStock(input: {
    pool: WarrantyPool;
    productId?: number;
    productName: string;
    serialNumber?: string;
    unit: string;
    quantity: number;
    direction: 1 | -1;
    date: string;
    note?: string;
    reason?: WarrantyStockMovement['reason'];
    refNo?: string;
  }): { ok: boolean; error?: string } {
    const name = (input.productName || '').trim();
    const quantity = this.roundMoney(Number(input.quantity));
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'product' };
    if (input.direction < 0) {
      const balance = this.warrantyStockOf(input.productId, name, input.unit);
      const available = input.pool === 'received' ? balance.received : balance.replacement;
      if (!this.warrantySettings().allowNegativeStock && quantity > available) return { ok: false, error: 'shortage' };
    }
    this.warrantyStockMovements.update(list => [
      this.warrantyMovement({
        date: input.date || localDateIso(),
        pool: input.pool,
        quantity: quantity * input.direction,
        productId: input.productId,
        productName: name,
        serialNumber: (input.serialNumber || '').trim(),
        unit: input.unit,
        reason: input.reason || 'manual',
        refNo: (input.refNo || '').trim() || 'MANUAL',
        note: (input.note || '').trim()
      }),
      ...list
    ]);
    this.saveWarrantyStock();
    return { ok: true };
  }

  /** Admin correction of one ledger row; balances recompute from the signed quantity. */
  updateWarrantyStockMovement(id: number, change: {
    pool: WarrantyPool;
    quantity: number;
    date: string;
    serialNumber?: string;
    refNo?: string;
    note?: string;
  }): { ok: boolean; error?: string } {
    const current = this.warrantyStockMovements().find(movement => movement.id === id);
    if (!current) return { ok: false, error: 'missing' };
    const quantity = this.roundMoney(Number(change.quantity));
    if (!Number.isFinite(quantity) || quantity === 0) return { ok: false, error: 'quantity' };
    if (change.pool !== 'received' && change.pool !== 'replacement') return { ok: false, error: 'pool' };
    // Quantity/pool of a claim-linked row mirrors the receipt or voucher; editing
    // them here would silently desync the ledger from the document.
    if (current.claimId != null && (change.pool !== current.pool || quantity !== current.quantity)) {
      return { ok: false, error: 'claimed' };
    }
    if (!this.warrantySettings().allowNegativeStock) {
      const balance = this.warrantyStockOf(current.productId, current.productName, current.unit);
      // When only the pool changes, the row's old quantity leaves one pool and enters another.
      const base = change.pool === current.pool ? balance[change.pool] - current.quantity : balance[change.pool];
      if (base + quantity < -0.0001) return { ok: false, error: 'shortage' };
    }
    const next: WarrantyStockMovement = {
      ...current,
      pool: change.pool,
      quantity,
      date: change.date || current.date,
      serialNumber: (change.serialNumber ?? current.serialNumber ?? '').trim(),
      refNo: (change.refNo ?? current.refNo ?? '').trim(),
      note: (change.note ?? current.note ?? '').trim()
    };
    this.warrantyStockMovements.update(list => list.map(movement => movement.id === id ? next : movement));
    this.saveWarrantyStock();
    return { ok: true };
  }

  deleteWarrantyStockMovement(id: number): { ok: boolean; error?: string } {
    const current = this.warrantyStockMovements().find(movement => movement.id === id);
    if (!current) return { ok: false, error: 'missing' };
    // Claim-linked rows belong to their document; cancel or delete that instead.
    if (current.claimId != null) return { ok: false, error: 'claimed' };
    if (!this.warrantySettings().allowNegativeStock) {
      const balance = this.warrantyStockOf(current.productId, current.productName, current.unit);
      if (balance[current.pool] - current.quantity < -0.0001) return { ok: false, error: 'shortage' };
    }
    this.warrantyStockMovements.update(list => list.filter(movement => movement.id !== id));
    this.saveWarrantyStock();
    return { ok: true };
  }

  private validateWarrantyReplacement(input: Omit<WarrantyReplacement, 'id' | 'claimNo' | 'createdAt'>, ignoreId?: number): string {
    if (!input.productName.trim() || !Number.isFinite(input.quantity) || input.quantity <= 0
      || !Number.isFinite(input.stockInQty) || input.stockInQty < 0
      || !Number.isFinite(input.cost) || input.cost < 0) return 'product';
    if ([input.quantity, input.stockInQty].some(value => !Number.isSafeInteger(Math.round(value * 100))
      || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7)) return 'precision';
    if (!['completed', 'pending', 'cancelled'].includes(input.stage)) return 'stage';
    if (input.source !== 'main' && input.source !== 'warranty') return 'product';
    const receipt = this.warrantyReceipts().find(r => r.id === input.receiptId);
    // A cancelled voucher is inert; it may outlive its receipt after a cleanup.
    if (!receipt && input.stage !== 'cancelled') return 'receipt';
    if (input.stage !== 'cancelled' && this.warrantyReplacements().some(r =>
      r.receiptId === input.receiptId && r.id !== ignoreId && r.stage !== 'cancelled')) return 'settled';
    const settings = this.warrantySettings();
    if (input.source === 'main') {
      if (!settings.allowMainStockReplacement) return 'main-disabled';
      const product = this.products().find(p => p.id === input.productId);
      if (!product) return 'product';
      if (product.unit.trim() !== input.unit.trim()) return 'unit';
    }
    const old = this.warrantyReplacements().find(r => r.id === ignoreId);
    return this.validateWarrantyStockChange(old, { ...input, id: ignoreId ?? 0, claimNo: '' });
  }

  private validateWarrantyStockChange(old?: WarrantyReplacement, next?: Omit<WarrantyReplacement, 'createdAt'>): string {
    if (this.warrantySettings().allowNegativeStock) return '';
    const changes = [
      ...(old ? this.warrantyReplacementMovements(old).map(m => ({ ...m, quantity: -m.quantity })) : []),
      ...(next ? this.warrantyReplacementMovements(next) : [])
    ];
    const balances = new Map<string, { amount: number; pool: WarrantyPool }>();
    for (const movement of changes) {
      const key = `${movement.pool}:${this.warrantyStockKey(movement.productId, movement.productName, movement.unit)}`;
      const current = balances.get(key) ?? {
        amount: this.warrantyStockOf(movement.productId, movement.productName, movement.unit)[movement.pool], pool: movement.pool
      };
      current.amount += movement.quantity;
      balances.set(key, current);
    }
    for (const balance of balances.values()) {
      if (balance.amount < -0.0001) return balance.pool === 'received' ? 'received-shortage' : 'shortage';
    }
    const main = new Map<number, number>();
    for (const [record, direction] of [[old, 1], [next, -1]] as const) {
      if (record?.stage !== 'completed' || record.source !== 'main' || record.productId == null) continue;
      const available = main.get(record.productId) ?? this.products().find(p => p.id === record.productId)?.stock ?? 0;
      main.set(record.productId, available + direction * record.quantity);
    }
    return [...main.values()].some(value => value < -0.0001) ? 'main-shortage' : '';
  }

  private warrantyReplacementMovements(record: Omit<WarrantyReplacement, 'createdAt'>): Omit<WarrantyStockMovement, 'id' | 'createdAt'>[] {
    if (record.stage !== 'completed') return [];
    const quantity = record.quantity;
    const stockInQty = record.stockInQty;
    const movements: Omit<WarrantyStockMovement, 'id' | 'createdAt'>[] = [];
    const direction = 1;
    if (record.source !== 'main' && quantity) {
      movements.push({
        date: record.date,
        pool: 'replacement',
        quantity: -quantity * direction,
        productId: record.productId,
        productName: record.productName,
        serialNumber: (record.serialNumber || '').trim(),
        unit: record.unit,
        reason: 'replacement',
        refNo: record.claimNo,
        claimId: record.id
      });
    }
    if (stockInQty) {
      movements.push({
        date: record.date,
        pool: 'replacement',
        quantity: stockInQty * direction,
        productId: record.productId,
        productName: record.productName,
        serialNumber: '',
        unit: record.unit,
        reason: 'supplier',
        refNo: record.supplierRef || record.claimNo,
        claimId: record.id,
        note: record.supplierName
      });
    }
    if (record.disposeReceived && record.receiptId != null) {
      const receipt = this.warrantyReceipts().find(r => r.id === record.receiptId);
      const receivedQty = Math.abs(Number(receipt?.quantity) || 0);
      if (receipt?.stockIn && receivedQty) {
        movements.push({
          date: record.date,
          pool: 'received',
          quantity: -receivedQty * direction,
          productId: receipt.productId,
          productName: receipt.productName,
          serialNumber: receipt.serialNumber,
          unit: receipt.unit,
          reason: 'disposal',
          refNo: record.claimNo,
          claimId: record.id,
          note: record.disposition
        });
      }
    }
    return movements;
  }

  private postWarrantyReplacement(record: WarrantyReplacement, direction: 1 | -1): void {
    if (record.stage !== 'completed') return;
    const movements = this.warrantyReplacementMovements(record).map(movement => this.warrantyMovement({
      ...movement, quantity: movement.quantity * direction,
      note: direction === -1 ? `Reversal · ${movement.note || record.claimNo}` : movement.note
    }));
    if (movements.length) {
      this.warrantyStockMovements.update(list => [...movements, ...list]);
      this.saveWarrantyStock();
    }
    if (record.source === 'main') this.adjustMainStock(record.productId, -record.quantity * direction);
    if (direction === 1) this.settleWarrantyReceipt(record);
    else this.reopenWarrantyReceipt(record);
  }

  private settleWarrantyReceipt(record: WarrantyReplacement): void {
    const receipt = this.warrantyReceipts().find(r => r.id === record.receiptId);
    if (!receipt) return;
    const at = new Date().toISOString();
    this.warrantyReceipts.update(list => list.map(r => (r.id === receipt.id ? {
      ...r,
      status: this.warrantySettings().autoSettleReceipt ? this.warrantySettings().receiptReplacedStatus : r.status,
      replacementClaimNo: record.claimNo,
      replacedAt: record.date,
      updatedAt: at
    } : r)));
    this.saveWarrantyReceipts();
  }

  private reopenWarrantyReceipt(record: WarrantyReplacement): void {
    const receipt = this.warrantyReceipts().find(r => r.id === record.receiptId);
    if (!receipt || receipt.replacementClaimNo !== record.claimNo) return;
    const at = new Date().toISOString();
    this.warrantyReceipts.update(list => list.map(r => (r.id === receipt.id ? {
      ...r,
      status: record.receiptPrevStatus || r.status,
      replacementClaimNo: undefined,
      replacedAt: undefined,
      updatedAt: at
    } : r)));
    this.saveWarrantyReceipts();
  }

  /** Receipt stock is posted once on create; edits post a correction instead of rewriting history. */
  private postWarrantyReceiptStock(record: WarrantyReceipt, direction: 1 | -1): void {
    if (!record.stockIn) return;
    const quantity = Math.abs(this.roundMoney(Number(record.quantity) || 0));
    if (!quantity) return;
    this.warrantyStockMovements.update(list => [
      this.warrantyMovement({
        date: record.date,
        pool: 'received',
        quantity: quantity * direction,
        productId: record.productId,
        productName: record.productName,
        serialNumber: (record.serialNumber || '').trim(),
        unit: record.unit,
        reason: 'receipt',
        refNo: record.claimNo,
        claimId: record.id,
        note: record.condition
      }),
      ...list
    ]);
    this.saveWarrantyStock();
  }

  private adjustMainStock(productId: number | undefined, delta: number): void {
    if (productId == null || !delta) return;
    this.products.update(list => list.map(product =>
      product.id === productId
        ? { ...product, stock: this.roundMoney((product.stock || 0) + delta) }
        : product));
  }

  private warrantyMovement(input: Omit<WarrantyStockMovement, 'id' | 'createdAt'>): WarrantyStockMovement {
    return {
      ...input,
      id: this.newId(),
      productName: (input.productName || '').trim(),
      quantity: this.roundMoney(input.quantity),
      createdAt: new Date().toISOString()
    };
  }

  addExpense(expense: Omit<Expense, 'id' | 'walletTxnId'>): Expense {
    const id = this.newId();
    const record: Expense = { ...expense, id };
    record.walletTxnId = this.postWalletOut({
      date: record.date,
      amount: record.amount,
      accountId: record.accountId,
      party: record.category || 'দৈনিক খরচ',
      note: record.title,
      source: 'Expense',
      refId: id
    });
    this.expenses.update(list => [record, ...list]);
    this.saveExpenses();
    return record;
  }

  updateExpense(id: number, patch: Partial<Expense>) {
    const old = this.expenses().find(e => e.id === id);
    if (!old) return;
    const next: Expense = { ...old, ...patch, id };
    next.walletTxnId = this.postWalletOut({
      txnId: old.walletTxnId,
      date: next.date,
      amount: next.amount,
      accountId: next.accountId,
      party: next.category || 'দৈনিক খরচ',
      note: next.title,
      source: 'Expense',
      refId: id
    });
    this.expenses.update(list => list.map(e => e.id === id ? next : e));
    this.saveExpenses();
  }

  deleteExpense(id: number) {
    const old = this.expenses().find(e => e.id === id);
    if (!old) return;
    this.removeWalletTxn(old.walletTxnId);
    this.archive('sm_expenses_v1', 'দৈনিক খরচ', old);
    this.expenses.update(list => list.filter(e => e.id !== id));
    this.saveExpenses();
  }

  // ------------------------------------------------------------------
  // Party ledger: payments, supplier returns and daily cash closing
  // ------------------------------------------------------------------
  recordPayment(input: {
    partyId: number;
    partyName: string;
    partyType: 'Customer' | 'Supplier';
    /** Which book the receipt settles; defaults from partyType. */
    side?: PartySide;
    amount: number;
    discount: number;
    mode: LedgerPayment['mode'];
    date: string;
    note: string;
  }): LedgerPayment {
    const amount = this.roundMoney(input.amount);
    const discount = this.roundMoney(input.discount);
    const id = this.newId();
    const receiptNo = this.nextDocNo('PAY', this.payments().map(p => p.receiptNo));
    const party = this.parties().find(p => p.id === input.partyId);
    const side: PartySide = input.side ?? (input.partyType === 'Supplier' ? 'purchase' : 'sales');
    const book = party ? this.sideAccount(party, side) : { total: 0, paid: 0, due: 0, advance: 0 };
    const settlement = this.roundMoney(Math.min(Math.max(0, book.due), amount + discount));
    const advance = this.roundMoney(amount + discount - settlement);
    const payment: LedgerPayment = {
      id,
      receiptNo,
      partyId: input.partyId,
      partyName: input.partyName,
      partyType: input.partyType,
      amount,
      discount,
      advance,
      mode: input.mode,
      date: input.date,
      note: input.note,
      createdAt: new Date().toISOString()
    };
    this.payments.update(list => [payment, ...list]);
    this.parties.update(list => list.map(p => {
      if (p.id !== input.partyId) return p;
      const patched = this.patchPartyAccount(p, side, { paid: amount, due: -settlement, advance }, side === 'purchase' ? 'Supplier' : 'Customer');
      return side === 'sales' ? this.consumePromise(patched, amount + discount) : patched;
    }));
    this.savePayments();
    this.saveParties();
    return payment;
  }

  /** A collection against the sales book also counts towards an active promise. */
  private consumePromise(party: Party, collected: number): Party {
    const promise = party.paymentPromise;
    if (!promise || !(collected > 0)) return party;
    const received = this.roundMoney(promise.received + collected);
    const done = received >= this.roundMoney(promise.amount);
    const history = [
      ...(promise.history ?? []),
      { at: new Date().toISOString(), kind: done ? 'done' as const : 'payment' as const, amount: this.roundMoney(collected) }
    ].slice(-40);
    return this.normalizeParty({ ...party, paymentPromise: { ...promise, received, history } });
  }

  /**
   * Writes a dated promise to pay part of the due. The due itself is never
   * touched: only the reminder board changes. Earlier dates and notes stay in
   * `history` so the follow-up trail survives a date change.
   */
  setPaymentPromise(partyId: number, input: { date: string; amount: number; note?: string }): PaymentPromise | null {
    const party = this.parties().find(p => p.id === partyId);
    if (!party) return null;
    const date = (input.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const amount = this.roundMoney(Math.max(0, input.amount));
    const note = (input.note || '').trim();
    const now = new Date().toISOString();
    const existing = party.paymentPromise;
    const history: ReminderHistoryEntry[] = [...(existing?.history ?? [])];
    const dateChanged = !!existing && existing.date !== date;
    const amountChanged = !!existing && this.roundMoney(existing.amount) !== amount;
    history.push({
      at: now,
      kind: !existing ? 'set' : dateChanged || amountChanged ? (dateChanged ? 'date' : 'set') : 'note',
      date,
      oldDate: dateChanged ? existing!.date : undefined,
      amount,
      text: note || undefined
    });
    const promise: PaymentPromise = {
      date,
      amount,
      received: existing ? this.roundMoney(existing.received) : 0,
      note: note || existing?.note,
      createdAt: existing?.createdAt ?? now,
      history: history.slice(-40)
    };
    this.parties.update(list => list.map(p => p.id === partyId ? this.normalizeParty({ ...p, paymentPromise: promise }) : p));
    this.saveParties();
    return promise;
  }

  recordSupplierReturn(input: {
    partyId: number;
    partyName: string;
    amount: number;
    date: string;
    note: string;
    items?: SupplierReturnItem[];
    invoiceNumber?: string;
    reason?: string;
    warehouse?: string;
    status?: string;
    discount?: number;
    discountType?: 'fixed' | 'percent';
    shipping?: number;
    orderTax?: string;
    taxAmount?: number;
    returnedBy?: string;
  }): SupplierReturn {
    const amount = this.roundMoney(input.amount);
    const id = this.newId();
    const supplierReturn: SupplierReturn = {
      id,
      returnNo: this.nextDocNo('SRET', this.supplierReturns().map(r => r.returnNo)),
      partyId: input.partyId,
      partyName: input.partyName,
      amount,
      date: input.date,
      note: input.note,
      items: (input.items || []).map(item => ({ ...item })),
      invoiceNumber: input.invoiceNumber,
      reason: input.reason,
      warehouse: input.warehouse,
      status: input.status,
      discount: input.discount,
      discountType: input.discountType,
      shipping: input.shipping,
      orderTax: input.orderTax,
      taxAmount: input.taxAmount,
      returnedBy: input.returnedBy,
      createdAt: new Date().toISOString(),
      shareKey: this.newShareKey()
    };
    this.preflightInventory(['supplier', supplierReturn, 1]);
    this.supplierReturns.update(list => [supplierReturn, ...list]);
    if (this.supplierReturnPosts(supplierReturn.status)) {
      // No clamping: a return bigger than the due is an advance with the
      // supplier, and deleting the note must restore the exact old balance.
      this.parties.update(list => list.map(p => p.id === input.partyId
        ? this.patchPartyAccount(p, 'purchase', { due: -amount })
        : p));
      this.postSupplierReturnStock(supplierReturn, 1);
    }
    this.saveSupplierReturns();
    this.saveParties();
    return supplierReturn;
  }

  /** A draft/cancelled note is paperwork only — it must not move stock or dues. */
  supplierReturnPosts(status?: string): boolean {
    const value = (status || '').trim().toLowerCase();
    return value !== 'draft' && value !== 'cancelled' && value !== 'canceled';
  }

  /** Returned goods leave the warehouse, so stock drops by the returned quantity. */
  private postSupplierReturnStock(record: SupplierReturn, direction: 1 | -1) {
    this.postInventory(['supplier', record, direction]);
  }

  saveCashClosing(input: Omit<CashClosing, 'id' | 'closedAt'>): CashClosing {
    const key = this.dateKey(input.date);
    const existing = this.cashClosings().find(c => this.dateKey(c.date) === key);
    if (existing) {
      const updated: CashClosing = { ...existing, ...input, closedAt: new Date().toISOString() };
      this.cashClosings.update(list => [
        updated,
        ...list.filter(c => c.id !== existing.id && this.dateKey(c.date) !== key)
      ]);
      this.saveCashClosings();
      return updated;
    }
    const closing: CashClosing = {
      ...input,
      id: this.newId(),
      closedAt: new Date().toISOString()
    };
    this.cashClosings.update(list => [closing, ...list]);
    this.saveCashClosings();
    return closing;
  }

  deleteCashClosing(id: number) {
    const closing = this.cashClosings().find(c => c.id === id);
    this.archive('sm_cash_closings_v1', 'ক্যাশ ক্লোজিং', closing);
    this.cashClosings.update(list => list.filter(c => c.id !== id));
    this.saveCashClosings();
  }

  private dateKey(value: string): string {
    const s = (value || '').trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return s;
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  // ------------------------------------------------------------------
  // Database: one IndexedDB record per collection, one auto-save effect per
  // collection. Reads happen once during bootstrap (hydration), so pages can
  // never see an empty shop while the database is still loading.
  // ------------------------------------------------------------------
  readonly hydrated = signal(false);

  /** key -> signal, the single place that decides what is persisted. */
  collections(): { key: string; signal: WritableSignal<any[]> }[] {
    return [
      { key: 'sm_products_v2', signal: this.products },
      { key: 'sm_categories_v2', signal: this.categories },
      { key: 'sm_sub_categories_v2', signal: this.subCategories },
      { key: 'sm_brands_v2', signal: this.brands },
      { key: 'sm_product_models_v2', signal: this.productModels },
      { key: 'sm_units_v1', signal: this.units },
      { key: 'sm_variations_v2', signal: this.variations },
      { key: 'sm_parties_v1', signal: this.parties },
      { key: 'sm_sales_v1', signal: this.sales },
      { key: 'sm_purchases_v1', signal: this.purchases },
      { key: 'sm_stock_adjustments_v1', signal: this.stockAdjustments },
      { key: 'sm_warranties_v1', signal: this.warranties },
      { key: 'sm_warranty_receipts_v1', signal: this.warrantyReceipts },
      { key: 'sm_warranty_replacements_v1', signal: this.warrantyReplacements },
      { key: 'sm_warranty_stock_v1', signal: this.warrantyStockMovements },
      { key: 'sm_warranty_settings_v1', signal: this.warrantySettingsRecords },
      { key: 'sm_expenses_v1', signal: this.expenses },
      { key: 'sm_payments_v1', signal: this.payments },
      { key: 'sm_supplier_returns_v1', signal: this.supplierReturns },
      { key: 'sm_cash_closings_v1', signal: this.cashClosings },
      { key: 'sm_sales_returns_v1', signal: this.salesReturns },
      { key: 'sm_staff_advances_v1', signal: this.staffAdvances },
      { key: 'sm_quotations_v1', signal: this.quotations },
      { key: 'sm_installments_v1', signal: this.installments },
      { key: 'sm_wallet_accounts_v1', signal: this.walletAccounts },
      { key: 'sm_wallet_txns_v1', signal: this.walletTransactions },
      { key: 'sm_observations_v1', signal: this.observations },
      { key: 'sm_hrm_staff_v1', signal: this.hrmStaff },
      { key: 'sm_attendance_v1', signal: this.attendance },
      { key: 'sm_hrm_leaves_v1', signal: this.hrmLeaves },
      { key: 'sm_salary_payments_v1', signal: this.salaryPayments },
      { key: 'sm_rent_payments_v1', signal: this.rentPayments },
      { key: 'sm_online_requests_v1', signal: this.onlineRequests },
      { key: 'sm_damage_records_v1', signal: this.damageRecords },
      { key: 'sm_battery_vouchers_v1', signal: this.batteryVouchers },
      { key: 'sm_battery_fund_transfers_v1', signal: this.batteryFundTransfers },
      { key: 'sm_warehouses_v1', signal: this.warehouses },
      { key: 'sm_recycle_v1', signal: this.recycleBin },
    ];
  }

  /** awaited by the app initializer before any page is created */
  async initDatabase(): Promise<void> {
    await this.storage.init();
    this.reloadFromStorage();
    this.hydrated.set(true);
    this.installAutoSave();
    // Writing tabs broadcast after each save; read-only tabs pull the fresh
    // collection so an open page never keeps showing yesterday's numbers.
    this.storage.onRemoteChange(() => this.scheduleRemoteRefresh());
  }

  private remoteRefreshTimer?: ReturnType<typeof setTimeout>;

  private scheduleRemoteRefresh(): void {
    if (this.remoteRefreshTimer) return;
    this.remoteRefreshTimer = setTimeout(() => {
      this.remoteRefreshTimer = undefined;
      this.reloadFromStorage();
    }, 150);
  }

  reloadFromStorage(): void {
    for (const entry of this.collections()) {
      const stored = this.storage.read<unknown>(entry.key);
      const fallback = entry.key === 'sm_wallet_accounts_v1'
        ? [
            { id: 1, name: 'ক্যাশ কাউন্টার', type: 'Cash', identifier: '', openingBalance: 0, status: 'Enabled', note: 'দোকানের নগদ বাক্স' },
            { id: 2, name: 'bKash', type: 'bKash', identifier: '', openingBalance: 0, status: 'Enabled', note: '' },
            { id: 3, name: 'Nagad', type: 'Nagad', identifier: '', openingBalance: 0, status: 'Enabled', note: '' },
            { id: 4, name: 'ব্যাংক অ্যাকাউন্ট', type: 'Bank', identifier: '', openingBalance: 0, status: 'Enabled', note: '' }
          ]
        : entry.key === 'sm_warehouses_v1' ? ['SM Warehouse']
        : entry.key === 'sm_units_v1' ? this.seedUnits() : [];
      const value = Array.isArray(stored) ? stored : fallback;
      entry.signal.set((entry.key === 'sm_warehouses_v1' ? this.normalizeWarehouses(value) : value) as never);
    }
    // The default flag must exist even on an older saved list.
    this.units.update(list => list.length && !list.some(unit => unit.isDefault)
      ? list.map((unit, index) => index === 0 ? { ...unit, isDefault: true } : unit)
      : list);
    // A walk-in bill is settled at the counter; old credit notes must not leave
    // a negative due on the document.
    this.sales.update(list => list.map(s =>
      isWalkInCustomer(s.customerName) && (Number(s.due) || 0) < 0
        ? { ...s, due: 0, paymentStatus: 'Paid' }
        : s));
    // Upgrade parties saved before multi-role books: fills `roles` and the
    // separate sales/purchase columns without touching the stored balances.
    this.parties.update(list => list.map(p => this.normalizeParty(p)));
    // Older saves (and sheet imports on other devices) may hold the same name
    // twice; products reference these entries by name, so one copy is enough.
    this.dedupeTaxonomy();
    const settings = this.storage.read<VoucherSettings>(this.voucherSettingsKey);
    this.voucherSettings.set(settings ? this.normalizeVoucherSettings(settings) : { ...this.defaultVoucherSettings });
  }

  private installAutoSave(): void {
    runInInjectionContext(this.injector, () => {
      for (const entry of this.collections()) {
        const signal = entry.signal;
        effect(() => this.storage.write(entry.key, signal()));
      }
      effect(() => this.storage.write(this.voucherSettingsKey, this.voucherSettings()));
    });
  }

  // Kept for the ledger/cash flows that persist explicitly; the auto-save
  // effects make a missed call harmless, but an immediate write stays cheap.
  private readStorage<T>(key: string): T | null {
    return this.storage.read<T>(key);
  }

  private writeStorage(key: string, value: unknown) {
    this.storage.write(key, value);
  }

  private saveParties() { this.writeStorage('sm_parties_v1', this.parties()); }
  private saveSales() { this.writeStorage('sm_sales_v1', this.sales()); }
  private savePurchases() { this.writeStorage('sm_purchases_v1', this.purchases()); }
  private saveStockAdjustments() { this.writeStorage('sm_stock_adjustments_v1', this.stockAdjustments()); }
  private saveExpenses() { this.writeStorage('sm_expenses_v1', this.expenses()); }
  private savePayments() { this.writeStorage('sm_payments_v1', this.payments()); }
  private saveWarranties() { this.writeStorage('sm_warranties_v1', this.warranties()); }
  private saveWarrantyReceipts() { this.writeStorage('sm_warranty_receipts_v1', this.warrantyReceipts()); }
  private saveWarrantyReplacements() { this.writeStorage('sm_warranty_replacements_v1', this.warrantyReplacements()); }
  private saveWarrantyStock() { this.writeStorage('sm_warranty_stock_v1', this.warrantyStockMovements()); }
  private saveSupplierReturns() { this.writeStorage('sm_supplier_returns_v1', this.supplierReturns()); }
  private saveCashClosings() { this.writeStorage('sm_cash_closings_v1', this.cashClosings()); }
  private saveBatteryFundTransfers() { this.writeStorage('sm_battery_fund_transfers_v1', this.batteryFundTransfers()); }

  // ------------------------------------------------------------------
  // Feature modules: credit notes, advances, quotations, installments,
  // wallet, observations, HRM, online requests and damage records.
  // ------------------------------------------------------------------
  /**
   * Ids are the Supabase row key, so two devices must never mint the same one.
   * Milliseconds alone collide when both save in the same tick, hence the per-device
   * salt plus a rolling counter. Still under Number.MAX_SAFE_INTEGER.
   */
  private idSalt = Math.floor(Math.random() * 1000);
  private idCounter = 0;

  newId(): number {
    this.idCounter = (this.idCounter + 1) % 1000;
    return Date.now() * 1000 + ((this.idSalt + this.idCounter) % 1000);
  }

  /**
   * Voucher QR links used to carry the invoice number, so anyone could walk the
   * sequence and read other customers' bills. 12 random base36 chars ≈ 62 bits.
   */
  newShareKey(): string {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 12);
  }

  /**
   * Add Sale and POS share one series — Sale-1001, Sale-1002, … — so a bill
   * printed from either screen keeps the shop's numbering in step. The number
   * follows the highest invoice actually issued: a reserved cloud block drifts
   * ahead as sessions come and go, and trusting it would jump the serial far
   * past the shop's real bills.
   */
  peekSaleVoucherNo(): string {
    let max = SALE_SERIAL_START;
    for (const sale of this.sales()) {
      const match = /^Sale-(\d+)$/.exec((sale.invoice || '').trim());
      if (match) max = Math.max(max, Number(match[1]));
    }
    return this.saleInvoiceNo(max + 1);
  }

  private saleInvoiceNo(value: number): string {
    return `Sale-${String(value).padStart(4, '0')}`;
  }

  /** Two devices can peek the same next number; the later save takes the next free one. */
  private freshSaleInvoice(invoice: string): string {
    const wanted = (invoice || '').trim();
    if (!wanted) return this.peekSaleVoucherNo();
    return this.sales().some(s => (s.invoice || '').trim() === wanted) ? this.peekSaleVoucherNo() : wanted;
  }

  peekPurchaseInvoice(): string {
    return this.nextPurchaseInvoice();
  }

  private localMax(start: number, existing: (string | undefined)[]): number {
    let local = start;
    for (const value of existing) {
      const m = /(\d+)\s*$/.exec((value || '').trim());
      if (m) local = Math.max(local, Number(m[1]));
    }
    return local;
  }

  private peekDocNo(prefix: string, existing: (string | undefined)[], start = 1000): string {
    const local = this.localMax(start, existing);
    const block = this.docBlocks.get(prefix);
    const next = block && block.next <= block.until ? block.next : local + 1;
    return `${prefix}-${next}`;
  }

  private docBlocks = new Map<string, { next: number; until: number }>();
  private claiming = new Set<string>();
  private static readonly DOC_BLOCK = 50;

  /** Deleted rows kept for restore; only beyond this many does the oldest drop off. */
  private static readonly RECYCLE_LIMIT = 2000;

  /**
   * Reserves this session's serial blocks before the first save, so two devices
   * opened at the same time cannot both auto-number a fresh invoice as PUR-1.
   * Sales are excluded: their number follows the bill actually issued, and the
   * abandoned tail of a reserved block would otherwise jump it weeks ahead.
   */
  async warmDocNumbers(): Promise<void> {
    if (this.docWarmStarted || !this.cloud.isEnabled()) return;
    this.docWarmStarted = true;
    const sources: [string, (string | undefined)[]][] = [
      ['PUR', this.purchases().map(p => p.invoice)],
      ['PAY', this.payments().map(p => p.receiptNo)],
      ['CRN', this.salesReturns().map(r => r.creditNoteNo)],
      ['SRET', this.supplierReturns().map(r => r.returnNo)]
    ];
    await Promise.all(sources
      .filter(([prefix]) => !this.docBlocks.has(prefix))
      .map(([prefix, numbers]) => this.reserveDocBlock(prefix, this.localMax(0, numbers) + 1)));
  }

  private docWarmStarted = false;

  /**
   * A plain local count hands two synced devices the same invoice number, and the
   * later Supabase write then overwrites the earlier record. So numbers are taken
   * from a block reserved in the cloud counter; offline the local count still works,
   * and the next reservation is pushed above everything already used.
   */
  private nextDocNo(prefix: string, existing: (string | undefined)[], start = 1000): string {
    let local = start;
    for (const value of existing) {
      const m = /(\d+)\s*$/.exec((value || '').trim());
      if (m) local = Math.max(local, Number(m[1]));
    }
    const block = this.docBlocks.get(prefix);
    if (block && block.next <= block.until) {
      const taken = block.next++;
      if (block.until - block.next < 10) void this.reserveDocBlock(prefix, Math.max(block.until, local) + 1);
      return `${prefix}-${taken}`;
    }
    void this.reserveDocBlock(prefix, local + 1 + DataService.DOC_BLOCK);
    return `${prefix}-${local + 1}`;
  }

  private async reserveDocBlock(prefix: string, floor: number): Promise<void> {
    if (this.claiming.has(prefix) || !this.cloud.isEnabled()) return;
    this.claiming.add(prefix);
    try {
      const to = await this.cloud.claimDocNos(prefix, DataService.DOC_BLOCK, floor);
      if (to) this.docBlocks.set(prefix, { next: Math.max(to - DataService.DOC_BLOCK + 1, floor), until: to });
    } finally {
      this.claiming.delete(prefix);
    }
  }

  private applyCreditNoteLedger(note: SalesReturn, sign: 1 | -1) {
    const amount = this.roundMoney(note.amount) * sign;
    if (!amount) return;
    // A printed invoice keeps its total — a credit note only settles what is owed.
    this.sales.update(list => list.map(s => {
      if (s.invoice !== note.invoiceNumber || (note.partyId != null && this.partyForReference(s.partyId, s.customerName)?.id !== note.partyId)) return s;
      // A walk-in bill is paid at the counter; an excess credit note must not
      // leave a negative due on the document.
      const due = isWalkInCustomer(s.customerName) ? 0 : this.roundMoney((s.due || 0) - amount);
      return {
        ...s,
        due,
        paymentStatus: due <= 0 ? 'Paid' : ((s.paid || 0) > 0 ? 'Partially Paid' : 'Unpaid')
      };
    }));
    const party = this.partyForReference(note.partyId, note.customerName);
    this.parties.update(list => list.map(p => (p.id === party?.id)
      ? this.patchPartyAccount(p, 'sales', { total: -amount, due: -amount })
      : p));
    this.saveSales();
    this.saveParties();
  }

  private restockReturnedItems(items: CreditNoteItem[], sign: 1 | -1) {
    this.postInventory(['credit', { items, status: 'Posted', restock: true } as SalesReturn, sign]);
  }

  recordSalesReturn(input: Omit<SalesReturn, 'id' | 'creditNoteNo' | 'createdAt'>): SalesReturn {
    const note: SalesReturn = {
      ...input,
      id: this.newId(),
      creditNoteNo: this.nextDocNo('CRN', this.salesReturns().map(x => x.creditNoteNo)),
      createdAt: new Date().toISOString(),
      shareKey: this.newShareKey()
    };
    note.partyId = this.partyForReference(note.partyId, note.customerName)?.id ?? note.partyId;
    this.preflightInventory(['credit', note, 1]);
    this.salesReturns.update(list => [note, ...list]);
    if (note.status === 'Posted') {
      this.applyCreditNoteLedger(note, 1);
      if (note.restock) this.restockReturnedItems(note.items, 1);
    }
    return note;
  }

  updateSalesReturn(id: number, patch: Partial<SalesReturn>): SalesReturn | null {
    const old = this.salesReturns().find(x => x.id === id);
    if (!old) return null;
    const next: SalesReturn = { ...old, ...patch, id };
    next.partyId = this.partyForReference(next.partyId, next.customerName)?.id ?? next.partyId;
    this.preflightInventory(['credit', old, -1], ['credit', next, 1]);
    if (old.status === 'Posted') {
      this.applyCreditNoteLedger(old, -1);
      if (old.restock) this.restockReturnedItems(old.items, -1);
    }
    this.salesReturns.update(list => list.map(x => x.id === id ? next : x));
    if (next.status === 'Posted') {
      this.applyCreditNoteLedger(next, 1);
      if (next.restock) this.restockReturnedItems(next.items, 1);
    }
    return next;
  }

  deleteSalesReturn(id: number) {
    const old = this.salesReturns().find(x => x.id === id);
    if (!old) return;
    this.preflightInventory(['credit', old, -1]);
    if (old.status === 'Posted') {
      this.applyCreditNoteLedger(old, -1);
      if (old.restock) this.restockReturnedItems(old.items, -1);
    }
    this.archive('sm_sales_returns_v1', 'ক্রেডিট নোট', old);
    this.salesReturns.update(list => list.filter(x => x.id !== id));
  }

  addStaffAdvance(input: Omit<StaffAdvance, 'id' | 'advanceNo' | 'createdAt' | 'walletTxnId' | 'recoveryTxnIds'>): StaffAdvance {
    const record: StaffAdvance = {
      ...input,
      recoveryTxnIds: [],
      id: this.newId(),
      advanceNo: this.nextDocNo('ADV', this.staffAdvances().map(x => x.advanceNo)),
      createdAt: new Date().toISOString()
    };
    record.walletTxnId = this.postWalletOut({
      date: record.date,
      amount: record.amount,
      accountId: record.status === 'Cancelled' ? undefined : record.accountId,
      party: record.staffName,
      note: `স্টাফ অ্যাডভান্স (${record.advanceNo})`,
      source: 'StaffAdvance',
      refId: record.id
    });
    this.staffAdvances.update(list => [record, ...list]);
    return record;
  }

  /** Open advance of one employee: the stored id wins, the name only rescues legacy rows. */
  staffAdvanceOpen(staffId: number | undefined, staffName: string | undefined): number {
    const open = this.staffAdvances()
      .filter(a => a.status !== 'Cancelled' && a.status !== 'Recovered')
      .filter(a => this.advanceBelongsTo(a, staffId, staffName))
      .reduce((acc, a) => acc + Math.max(0, (a.amount || 0) - (a.recoveredAmount || 0)), 0);
    return this.roundMoney(open);
  }

  private advanceBelongsTo(advance: StaffAdvance, staffId: number | undefined, staffName: string | undefined): boolean {
    // Two employees may share a name; an id-tagged advance never crosses to the other one.
    if (advance.staffId != null) return staffId != null && advance.staffId === staffId;
    const name = (staffName || '').trim().toLowerCase();
    return !!name && (advance.staffName || '').trim().toLowerCase() === name;
  }

  updateStaffAdvance(id: number, patch: Partial<StaffAdvance>) {
    const old = this.staffAdvances().find(x => x.id === id);
    if (!old) return;
    const next: StaffAdvance = { ...old, ...patch, id, walletTxnId: old.walletTxnId };
    next.walletTxnId = this.postWalletOut({
      txnId: old.walletTxnId,
      date: next.date,
      amount: next.amount,
      accountId: next.status === 'Cancelled' ? undefined : next.accountId,
      party: next.staffName,
      note: `স্টাফ অ্যাডভান্স (${next.advanceNo})`,
      source: 'StaffAdvance',
      refId: next.id
    });
    this.staffAdvances.update(list => list.map(x => x.id === id ? next : x));
  }

  deleteStaffAdvance(id: number) {
    const old = this.staffAdvances().find(x => x.id === id);
    this.archive('sm_staff_advances_v1', 'স্টাফ অ্যাডভান্স', old);
    this.removeWalletTxn(old?.walletTxnId);
    for (const txnId of old?.recoveryTxnIds ?? []) this.removeWalletTxn(txnId);
    this.staffAdvances.update(list => list.filter(x => x.id !== id));
  }

  /** `postToWallet` is for a real cash recovery; payroll adjustments only reduce the balance. */
  recoverStaffAdvance(id: number, amount: number, options?: { accountId?: number; date?: string; postToWallet?: boolean }) {
    const recovered = this.roundMoney(amount);
    const old = this.staffAdvances().find(x => x.id === id);
    if (!old) return;
    const total = this.roundMoney((old.recoveredAmount || 0) + recovered);
    const accountId = options?.accountId ?? old.accountId;
    const accountExists = !!accountId && this.walletAccounts().some(a => a.id === accountId);
    let recoveredTxnId: number | undefined;
    if (options?.postToWallet && accountExists && recovered > 0) {
      recoveredTxnId = this.addWalletTransaction({
        date: options.date || localDateIso(),
        direction: 'In',
        accountId,
        amount: recovered,
        party: old.staffName,
        note: `এডভান্স রিকভার (${old.advanceNo})`,
        source: 'StaffAdvance',
        refId: old.id
      }).id;
    }
    this.staffAdvances.update(list => list.map(x => {
      if (x.id !== id) return x;
      const next: StaffAdvance = { ...x, recoveredAmount: total, status: total >= x.amount ? 'Recovered' : x.status };
      if (recoveredTxnId !== undefined) {
        next.recoveryTxnIds = [...(x.recoveryTxnIds ?? []), recoveredTxnId];
        next.accountId = accountId;
      }
      return next;
    }));
  }

  addQuotation(input: Omit<Quotation, 'id' | 'quoteNo' | 'createdAt'>): Quotation {
    const record: Quotation = {
      ...input,
      id: this.newId(),
      quoteNo: this.nextDocNo('QTE', this.quotations().map(x => x.quoteNo)),
      createdAt: new Date().toISOString()
    };
    this.quotations.update(list => [record, ...list]);
    return record;
  }

  updateQuotation(id: number, patch: Partial<Quotation>) {
    this.quotations.update(list => list.map(x => x.id === id ? { ...x, ...patch, id } : x));
  }

  deleteQuotation(id: number) {
    this.archive('sm_quotations_v1', 'কোটেশন', this.quotations().find(x => x.id === id));
    this.quotations.update(list => list.filter(x => x.id !== id));
  }

  convertQuotation(id: number, invoiceNumber: string): Sale | null {
    const quotation = this.quotations().find(x => x.id === id);
    if (!quotation) return null;

    const invoice = (invoiceNumber || '').trim();
    if (!invoice) return null;

    const products = this.products();
    const items: SaleItem[] = (quotation.items || []).map((item, index) => {
      const product = products.find(p => p.name === item.productName);
      const quantity = this.roundMoney(Number(item.quantity) || 0);
      const salesPrice = this.roundMoney(Number(item.unitPrice) || 0);
      return {
        id: this.newId(),
        productId: product?.id,
        productName: item.productName,
        quantity,
        unit: product?.unit || 'pcs',
        salesPrice,
        total: this.roundMoney(quantity * salesPrice)
      };
    });

    const subtotal = this.roundMoney(items.reduce((sum, item) => sum + item.total, 0));
    const discount = this.roundMoney(Math.min(Math.max(Number(quotation.discount) || 0, 0), subtotal));
    const total = this.roundMoney(subtotal - discount);
    const date = quotation.date || localDateIso();
    const walkIn = (quotation.customerName || '').trim() === 'Walk In Customer';

    const sale: Omit<Sale, 'id'> = {
      invoice,
      warehouse: 'SM Warehouse',
      date,
      customerName: quotation.customerName,
      mobile: quotation.phone,
      address: quotation.address,
      preparedBy: this.voucherSettings().soldBy || 'Admin',
      status: 'Completed',
      subtotal,
      discount,
      discountType: 'fixed',
      total,
      // Walk-in has no account to owe, so converting the quote settles it in cash.
      paid: walkIn ? total : 0,
      due: walkIn ? 0 : total,
      paymentStatus: walkIn ? 'Paid' : 'Unpaid',
      cashReceived: walkIn ? total : 0,
      paymentMode: walkIn ? 'Cash' : undefined,
      nextPayDate: '-',
      notes: `কোটেশন ${quotation.quoteNo} থেকে রূপান্তর${quotation.note ? ` — ${quotation.note}` : ''}`,
      items
    };

    this.addSale(sale);
    this.quotations.update(list => list.map(x => x.id === id
      ? { ...x, status: 'Converted', convertedInvoice: invoice }
      : x));

    return this.sales().find(s => s.invoice === invoice) ?? null;
  }

  addInstallment(input: Omit<Installment, 'id' | 'installmentNo' | 'createdAt'>): Installment {
    const record: Installment = {
      ...input,
      id: this.newId(),
      installmentNo: this.nextDocNo('INS', this.installments().map(x => x.installmentNo)),
      createdAt: new Date().toISOString()
    };
    this.installments.update(list => [record, ...list]);
    return record;
  }

  updateInstallment(id: number, patch: Partial<Installment>) {
    this.installments.update(list => list.map(x => x.id === id ? { ...x, ...patch, id } : x));
  }

  deleteInstallment(id: number) {
    this.archive('sm_installments_v1', 'ইনস্টলমেন্ট', this.installments().find(x => x.id === id));
    this.installments.update(list => list.filter(x => x.id !== id));
  }

  installmentPaid(record: Installment): number {
    return this.roundMoney(record.downPayment + (record.payments || []).reduce((acc, p) => acc + (p.amount || 0), 0));
  }

  installmentDue(record: Installment): number {
    return Math.max(0, this.roundMoney(record.totalAmount - this.installmentPaid(record)));
  }

  addWalletAccount(input: Omit<WalletAccount, 'id'>): WalletAccount {
    const record: WalletAccount = { ...input, id: this.newId() };
    this.walletAccounts.update(list => [...list, record]);
    return record;
  }

  updateWalletAccount(id: number, patch: Partial<WalletAccount>) {
    this.walletAccounts.update(list => list.map(x => x.id === id ? { ...x, ...patch, id } : x));
  }

  deleteWalletAccount(id: number) {
    const account = this.walletAccounts().find(x => x.id === id);
    const txns = this.walletTransactions().filter(x => x.accountId === id);
    this.archive('sm_wallet_accounts_v1', 'ওয়ালেট', account,
      txns.length ? { collection: 'sm_wallet_txns_v1', rows: txns } : undefined);
    this.walletAccounts.update(list => list.filter(x => x.id !== id));
    this.walletTransactions.update(list => list.filter(x => x.accountId !== id));
  }

  addWalletTransaction(input: Omit<WalletTransaction, 'id' | 'txnNo' | 'createdAt'>): WalletTransaction {
    const record: WalletTransaction = {
      ...input,
      amount: this.roundMoney(Number(input.amount) || 0),
      id: this.newId(),
      txnNo: this.freshWalletTxnNo(),
      createdAt: new Date().toISOString()
    };
    this.walletTransactions.update(list => [record, ...list]);
    return record;
  }

  /**
   * Wallet numbers run WLT-1001, WLT-1002 … from the rows actually saved. A
   * reserved cloud block starts 50 numbers ahead on the very first deposit, and
   * that gap would show on every later receipt, so the serial follows the ledger.
   */
  private freshWalletTxnNo(): string {
    const numbers = this.walletTransactions().map(t => t.txnNo);
    const used = new Set(numbers.map(value => (value || '').trim()));
    let value = this.localMax(1000, numbers) + 1;
    while (used.has(`WLT-${value}`)) value++;
    return `WLT-${value}`;
  }

  deleteWalletTransaction(id: number) {
    this.archive('sm_wallet_txns_v1', 'ওয়ালেট লেনদেন', this.walletTransactions().find(x => x.id === id));
    this.walletTransactions.update(list => list.filter(x => x.id !== id));
  }

  /** Rows saved before battery vouchers tagged their source are still owned by the voucher. */
  walletTxnOwnedByBattery(txnId: number): boolean {
    return this.batteryVouchers().some(v => (v.walletTxnIds ?? []).includes(txnId));
  }

  /** Rows a document owns must be changed or cancelled from that document. */
  walletTxnLinkedToDocument(txn: WalletTransaction): boolean {
    return (!!txn.source && txn.source !== 'Manual') || this.walletTxnOwnedByBattery(txn.id);
  }

  walletAccountLinkedTxns(accountId: number): WalletTransaction[] {
    return this.walletTransactions()
      .filter(t => t.accountId === accountId && this.walletTxnLinkedToDocument(t));
  }

  walletBalance(accountId: number): number {
    const account = this.walletAccounts().find(x => x.id === accountId);
    if (!account) return 0;
    const movement = this.walletTransactions()
      .filter(x => x.accountId === accountId)
      .reduce((acc, x) => acc + (x.direction === 'In' ? 1 : -1) * (x.amount || 0), 0);
    return this.roundMoney((account.openingBalance || 0) + movement);
  }

  walletTotals() {
    return this.walletAccounts().reduce((acc, a) => acc + this.walletBalance(a.id), 0);
  }

  /** The single "মূল ব্যালেন্স": every wallet account's opening balance plus its movements. */
  readonly mainBalance = computed(() => Math.round(this.walletAccounts()
    .reduce((acc, a) => acc + this.walletBalance(a.id), 0) * 100) / 100);

  /**
   * Keeps exactly one wallet "Out" row in step with an HRM document. A missing
   * account means the document only records the obligation (rent "Due", for
   * example) and no cash has moved yet.
   */
  private postWalletOut(input: {
    txnId?: number;
    date: string;
    amount: number;
    accountId?: number;
    party: string;
    note: string;
    source: WalletTransaction['source'];
    refId?: number;
  }): number | undefined {
    const amount = this.roundMoney(Number(input.amount) || 0);
    const existing = input.txnId ? this.walletTransactions().find(t => t.id === input.txnId) : undefined;
    // A document edited on a stale tab may still point at a deleted account;
    // posting against it would park money in a ledger nobody can see.
    const accountExists = !!input.accountId && this.walletAccounts().some(a => a.id === input.accountId);
    if (!accountExists || amount <= 0) {
      if (existing) this.walletTransactions.update(list => list.filter(t => t.id !== existing.id));
      return undefined;
    }
    if (existing) {
      this.walletTransactions.update(list => list.map(t => t.id === existing.id
        ? { ...t, date: input.date, accountId: input.accountId!, amount, party: input.party, note: input.note, source: input.source, refId: input.refId }
        : t));
      return existing.id;
    }
    const created = this.addWalletTransaction({
      date: input.date,
      direction: 'Out',
      accountId: input.accountId!,
      amount,
      party: input.party,
      note: input.note,
      source: input.source,
      refId: input.refId
    });
    return created.id;
  }

  private removeWalletTxn(txnId?: number) {
    if (!txnId) return;
    this.walletTransactions.update(list => list.filter(t => t.id !== txnId));
  }

  // ------------------------------------------------------------------
  // Old battery management: purchase / kg-sale / exchange vouchers.
  // ------------------------------------------------------------------
  private batteryPrefix(type: BatteryVoucherType): string {
    return type === 'purchase' ? 'BPUR' : type === 'sale' ? 'BSAL' : 'BEX';
  }

  nextBatteryVoucherNo(type: BatteryVoucherType): string {
    return this.nextDocNo(this.batteryPrefix(type), this.batteryVouchers().filter(v => v.type === type).map(v => v.voucherNo), 0);
  }

  peekBatteryVoucherNo(type: BatteryVoucherType): string {
    return this.peekDocNo(this.batteryPrefix(type), this.batteryVouchers().filter(v => v.type === type).map(v => v.voucherNo), 0);
  }

  /**
   * Battery stock is costed lot by lot: each sale takes the oldest bought
   * kilograms first, so it carries the purchase cost it actually consumed.
   * Vouchers are read in date/creation order; a sale running past the bought
   * lots has an incomplete cost basis and must not read as pure profit.
   */
  private batteryLotCache?: {
    list: BatteryVoucher[];
    sales: Map<number, { cost: number; missing: boolean }>;
    remaining: Map<string, { qty: number; value: number }>;
  };

  private batteryLotBook() {
    const list = this.batteryVouchers();
    if (this.batteryLotCache && this.batteryLotCache.list === list) return this.batteryLotCache;
    const lots = new Map<string, { qty: number; rate: number }[]>();
    const alias = new Map<string, string>();
    const bucket = (key: string) => {
      let rows = lots.get(key);
      if (!rows) {
        rows = [];
        lots.set(key, rows);
      }
      return rows;
    };
    // Legacy lines carry only a localized label; remember the catalog key they map to.
    const keyOf = (kindKey: string | undefined, label: string | undefined) => {
      if (kindKey) {
        if (label && label !== kindKey) alias.set(label, kindKey);
        return kindKey;
      }
      const text = (label || 'other').trim();
      return alias.get(text) || text;
    };
    const consume = (key: string, qty: number) => {
      let need = qty, cost = 0;
      for (const lot of bucket(key)) {
        if (need <= 0) break;
        const take = Math.min(need, lot.qty);
        cost += take * lot.rate;
        lot.qty -= take;
        need -= take;
      }
      return { cost, short: need > 1e-9 };
    };

    const sales = new Map<number, { cost: number; missing: boolean }>();
    // The list is newest-first, so an identical date and timestamp means the later
    // index is the older voucher — a same-day purchase must be costed before the sale.
    const sorted = list
      .map((voucher, index) => ({ voucher, index }))
      .sort((a, b) =>
        (a.voucher.date || '').localeCompare(b.voucher.date || '')
        || (a.voucher.createdAt || '').localeCompare(b.voucher.createdAt || '')
        || b.index - a.index)
      .map(entry => entry.voucher);
    for (const voucher of sorted) {
      if (voucher.type === 'purchase') {
        for (const line of voucher.lines ?? []) {
          const qty = Number(line.kg) || 0;
          if (qty <= 0) continue;
          bucket(keyOf(line.kindKey, line.kind)).push({ qty, rate: Number(line.rate) || 0 });
        }
        continue;
      }
      if (voucher.type !== 'sale') continue;
      let cost = 0, missing = false;
      for (const line of voucher.lines ?? []) {
        const qty = Number(line.kg) || 0;
        if (qty <= 0) continue;
        const taken = consume(keyOf(line.kindKey, line.kind), qty);
        cost += taken.cost;
        if (taken.short) missing = true;
      }
      sales.set(voucher.id, { cost: this.roundMoney(cost), missing });
    }

    const remaining = new Map<string, { qty: number; value: number }>();
    for (const [key, rows] of lots) {
      let qty = 0, value = 0;
      for (const lot of rows) {
        qty += lot.qty;
        value += lot.qty * lot.rate;
      }
      remaining.set(key, { qty, value: this.roundMoney(value) });
    }
    for (const [label, key] of alias) {
      const entry = remaining.get(key);
      if (entry) remaining.set(label, entry);
    }

    this.batteryLotCache = { list, sales, remaining };
    return this.batteryLotCache;
  }

  /** Cost of unsaved sale lines at the remaining lot cost of each kind (the sale form's estimate). */
  batteryLinesCost(lines: BatteryLine[] | undefined): number {
    return this.batteryLinesCostDetail(lines).cost;
  }

  batteryLinesCostIncomplete(lines: BatteryLine[] | undefined): boolean {
    return this.batteryLinesCostDetail(lines).missing;
  }

  private batteryLinesCostDetail(lines: BatteryLine[] | undefined): { cost: number; missing: boolean } {
    const remaining = this.batteryLotBook().remaining;
    let cost = 0, missing = false;
    for (const line of lines ?? []) {
      const qty = Number(line.kg) || 0;
      if (qty <= 0) continue;
      const entry = remaining.get(line.kindKey || '')
        ?? remaining.get((line.kind || '').trim());
      if (!entry || entry.qty <= 0) {
        missing = true;
        continue;
      }
      const take = Math.min(qty, entry.qty);
      cost += take * (entry.value / entry.qty);
      // Everything past the remaining lots has no purchase cost behind it.
      if (take < qty - 1e-9) missing = true;
    }
    return { cost: this.roundMoney(cost), missing };
  }

  /** Sale cost basis: the entered lot cost, else the lots the sold kilograms came from. */
  batteryVoucherCost(voucher: BatteryVoucher): number {
    const entered = Number(voucher.cost) || 0;
    if (entered > 0) return this.roundMoney(entered);
    const basis = this.batteryLotBook().sales.get(voucher.id);
    return basis ? basis.cost : this.batteryLinesCost(voucher.lines);
  }

  /** True when a sale has no entered cost and its kilograms were never bought. */
  batteryVoucherCostIncomplete(voucher: BatteryVoucher): boolean {
    if (voucher.type !== 'sale') return false;
    if ((Number(voucher.cost) || 0) > 0) return false;
    const sold = (voucher.lines ?? []).some(line => (Number(line.kg) || 0) > 0);
    if (!sold) return (Number(voucher.total) || 0) > 0;
    const basis = this.batteryLotBook().sales.get(voucher.id);
    return basis ? basis.missing : this.batteryLinesCostIncomplete(voucher.lines);
  }

  /** Profit recognised by a single voucher: sale margin plus exchange fee. */
  batteryVoucherProfit(voucher: BatteryVoucher): number {
    if (voucher.type === 'sale') {
      // Without a purchase cost the revenue is not a profit — the UI says "ক্রয়খরচ অসম্পূর্ণ".
      if (this.batteryVoucherCostIncomplete(voucher)) return 0;
      return this.roundMoney((voucher.total || 0) - this.batteryVoucherCost(voucher));
    }
    if (voucher.type === 'exchange') return this.roundMoney(voucher.fee || voucher.total || 0);
    return 0;
  }

  /** Correct a saved sale's lot cost without touching stock, purchases or postings. */
  setBatteryVoucherCost(id: number, cost: number) {
    this.batteryVouchers.update(list =>
      list.map(v => v.id === id ? { ...v, cost: this.roundMoney(cost) } : v));
  }

  batterySummary(): BatterySummary {
    const list = this.batteryVouchers();
    let purchaseTotal = 0, saleTotal = 0, saleCost = 0, exchangeFee = 0, profit = 0, incompleteSales = 0;
    // Kg and pcs never share a column: a piece is not a weight.
    let stockKg = 0, stockPcs = 0, purchasedKg = 0, purchasedKgValue = 0;
    const addStock = (unit: BatteryUnit | undefined, delta: number, rate = 0) => {
      if (unit === 'pcs') {
        stockPcs += delta;
        return;
      }
      stockKg += delta;
      if (delta > 0) {
        purchasedKg += delta;
        purchasedKgValue += delta * rate;
      }
    };

    for (const v of list) {
      if (v.type === 'purchase') {
        purchaseTotal += v.total || 0;
        // Older vouchers may only carry a voucher-level total, so fall back to it as kg.
        if (!(v.lines ?? []).length && (v.totalKg || 0) > 0) addStock('kg', v.totalKg || 0);
        for (const l of v.lines ?? []) {
          const qty = Number(l.kg) || 0;
          if (qty > 0) addStock(l.unit, qty, Number(l.rate) || 0);
        }
      } else if (v.type === 'sale') {
        saleTotal += v.total || 0;
        if (this.batteryVoucherCostIncomplete(v)) incompleteSales++;
        else saleCost += this.batteryVoucherCost(v);
        if (!(v.lines ?? []).length && (v.totalKg || 0) > 0) addStock('kg', -(v.totalKg || 0));
        for (const l of v.lines ?? []) {
          const qty = Number(l.kg) || 0;
          if (qty > 0) addStock(l.unit, -qty);
        }
      } else {
        exchangeFee += v.fee || v.total || 0;
        stockKg += (v.receivedKg || 0) - (v.givenKg || 0);
      }
      profit += this.batteryVoucherProfit(v);
    }

    const avgCostPerKg = purchasedKg > 0 ? purchasedKgValue / purchasedKg : 0;
    const stockValue = this.batteryKindStock().reduce((sum, kind) => sum + (Number(kind.value) || 0), 0);
    return {
      purchaseTotal: this.roundMoney(purchaseTotal),
      saleTotal: this.roundMoney(saleTotal),
      saleCost: this.roundMoney(saleCost),
      exchangeFee: this.roundMoney(exchangeFee),
      profit: this.roundMoney(profit),
      stockKg: Math.round(stockKg * 100) / 100,
      stockPcs: Math.round(stockPcs * 100) / 100,
      stockValue: this.roundMoney(stockValue),
      avgCostPerKg: Math.round(avgCostPerKg * 100) / 100,
      incompleteSales
    };
  }

  addBatteryVoucher(input: Omit<BatteryVoucher, 'id' | 'voucherNo' | 'shareKey' | 'walletTxnIds'>): BatteryVoucher {
    const record: BatteryVoucher = {
      ...input,
      id: this.newId(),
      voucherNo: this.nextBatteryVoucherNo(input.type),
      shareKey: this.newShareKey(),
      walletTxnIds: []
    };
    this.batteryVouchers.update(list => [record, ...list]);
    this.postBatteryWallet(record, 1);
    this.postBatteryParty(record, 1);
    return this.batteryVouchers().find(v => v.id === record.id) ?? record;
  }

  updateBatteryVoucher(id: number, input: Omit<BatteryVoucher, 'id' | 'voucherNo' | 'shareKey' | 'walletTxnIds'>) {
    const previous = this.batteryVouchers().find(v => v.id === id);
    if (!previous) return;
    if (this.batteryFundAllocatedFor(id) > 0) {
      this.notify.error(
        this.prefs.txt(
          `${previous.voucherNo} এর কিছু টাকা ব্যাটারি ফান্ড থেকে পরিশোধ হয়েছে — আগে সংশ্লিষ্ট ফান্ড ট্রান্সফারটি মুছুন, তারপর ভাউচারটি বদলান।`,
          `Part of ${previous.voucherNo} was paid from the battery fund — delete that fund transfer first, then edit the voucher.`
        ),
        this.prefs.txt('ফান্ডে পরিশোধিত ভাউচার', 'Fund-settled voucher')
      );
      return;
    }
    this.postBatteryWallet(previous, -1);
    if (previous.partyPosted) this.postBatteryParty(previous, -1);
    const record: BatteryVoucher = { ...input, id, voucherNo: previous.voucherNo, shareKey: previous.shareKey, walletTxnIds: [] };
    this.batteryVouchers.update(list => list.map(v => v.id === id ? record : v));
    this.postBatteryWallet(record, 1);
    this.postBatteryParty(record, 1);
  }

  deleteBatteryVoucher(id: number) {
    const previous = this.batteryVouchers().find(v => v.id === id);
    if (!previous) return;
    if (this.batteryFundAllocatedFor(id) > 0) {
      this.notify.error(
        this.prefs.txt(
          `${previous.voucherNo} এর কিছু টাকা ব্যাটারি ফান্ড থেকে পরিশোধ হয়েছে — আগে সংশ্লিষ্ট ফান্ড ট্রান্সফারটি মুছুন, তারপর ভাউচারটি মুছুন।`,
          `Part of ${previous.voucherNo} was paid from the battery fund — delete that fund transfer first, then delete the voucher.`
        ),
        this.prefs.txt('ফান্ডে পরিশোধিত ভাউচার', 'Fund-settled voucher')
      );
      return;
    }
    this.archive('sm_battery_vouchers_v1', 'ব্যাটারি ভাউচার', previous);
    this.postBatteryWallet(previous, -1);
    if (previous.partyPosted) this.postBatteryParty(previous, -1);
    this.batteryVouchers.update(list => list.filter(v => v.id !== id));
  }

  // ------------------------------------------------------------------
  // Battery stock fund: the unpaid part of old-battery purchases, kept per
  // party and paid out through the same wallet accounts as the vouchers.
  // ------------------------------------------------------------------
  private batteryPurchaseVouchers(): BatteryVoucher[] {
    return this.batteryVouchers().filter(v => v.type === 'purchase' && v.source !== 'sale-adjustment');
  }

  /** Fund money already sent to a party, keyed by the purchase voucher it settled. */
  batteryFundAllocationsByVoucher(): Map<number, number> {
    const map = new Map<number, number>();
    for (const transfer of this.batteryFundTransfers()) {
      for (const line of transfer.allocations ?? []) {
        map.set(line.voucherId, this.roundMoney((map.get(line.voucherId) || 0) + (Number(line.amount) || 0)));
      }
    }
    return map;
  }

  batteryFundAllocatedFor(voucherId: number): number {
    return this.batteryFundAllocationsByVoucher().get(voucherId) || 0;
  }

  /**
   * Remaining fund per party: each unpaid purchase voucher's due, less the
   * allocations already transferred. Sales trade-ins are settled on their
   * invoice and never feed the fund.
   */
  batteryFundByParty(): Map<number, number> {
    const allocated = this.batteryFundAllocationsByVoucher();
    const map = new Map<number, number>();
    for (const voucher of this.batteryPurchaseVouchers()) {
      const party = this.partyForReference(voucher.partyId, voucher.partyName);
      if (!party) continue;
      const free = Math.max(0, (Number(voucher.due) || 0) - (allocated.get(voucher.id) || 0));
      if (free <= 0) continue;
      map.set(party.id, this.roundMoney((map.get(party.id) || 0) + free));
    }
    return map;
  }

  batteryFundAvailable(): number {
    let total = 0;
    for (const value of this.batteryFundByParty().values()) total += value;
    return this.roundMoney(total);
  }

  batteryFundOfParty(partyId: number): number {
    return this.batteryFundByParty().get(partyId) || 0;
  }

  nextBatteryFundTransferNo(): string {
    return this.nextDocNo('BFT', this.batteryFundTransfers().map(t => t.transferNo));
  }

  /**
   * Sends battery-fund money to a seller: a normal supplier receipt settles the
   * purchase book (due first, the rest as advance), a wallet "Out" row records
   * the cash, and the allocations remember which vouchers the fund paid.
   */
  transferBatteryFund(input: {
    partyId: number;
    amount: number;
    mode: LedgerPayment['mode'];
    date: string;
    note: string;
    createdBy?: string;
  }): { ok: true; transfer: BatteryFundTransfer } | { ok: false; error: string } {
    const party = this.parties().find(p => p.id === input.partyId);
    if (!party || isWalkInCustomer(party.name)) {
      return { ok: false, error: this.prefs.txt('পার্টি পাওয়া যায়নি।', 'The party was not found.') };
    }
    const amount = this.roundMoney(input.amount);
    if (!(amount > 0)) {
      return { ok: false, error: this.prefs.txt('টাকার পরিমাণ দিন।', 'Enter an amount.') };
    }
    const available = this.batteryFundOfParty(party.id);
    if (amount > available + 0.005) {
      return {
        ok: false,
        error: this.prefs.txt(
          `${party.name} এর ব্যাটারি ফান্ডে মাত্র ${available.toFixed(2)} TK আছে।`,
          `${party.name} has only ${available.toFixed(2)} TK in the battery fund.`
        )
      };
    }
    const account = this.walletAccounts().find(a => a.type === input.mode && a.status === 'Enabled')
      ?? this.walletAccounts().find(a => a.type === input.mode);
    if (!account) {
      return { ok: false, error: this.prefs.txt('নির্বাচিত ওয়ালেট অ্যাকাউন্টটি পাওয়া যায়নি।', 'The selected wallet account was not found.') };
    }

    const allocations = this.allocateBatteryFund(party, amount);
    const transfer: BatteryFundTransfer = {
      id: this.newId(),
      transferNo: this.nextBatteryFundTransferNo(),
      date: input.date,
      partyId: party.id,
      partyName: party.name,
      amount,
      mode: input.mode,
      accountId: account.id,
      allocations,
      note: input.note.trim(),
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy
    };
    this.batteryFundTransfers.update(list => [transfer, ...list]);

    const payment = this.recordPayment({
      partyId: party.id,
      partyName: party.name,
      partyType: 'Supplier',
      side: 'purchase',
      amount,
      discount: 0,
      mode: input.mode,
      date: input.date,
      note: [`${transfer.transferNo} · ${this.prefs.txt('ব্যাটারি ফান্ড থেকে পরিশোধ', 'paid from battery fund')}`, input.note.trim()].filter(Boolean).join(' — ')
    });
    this.payments.update(list => list.map(p => p.id === payment.id ? { ...p, batteryFundTransferId: transfer.id } : p));
    this.savePayments();

    const txn = this.addWalletTransaction({
      date: input.date,
      direction: 'Out',
      accountId: account.id,
      amount,
      party: party.name,
      note: `${transfer.transferNo} · ${this.prefs.txt('ব্যাটারি ফান্ড', 'battery fund')} → ${party.name}`,
      source: 'Battery',
      refId: transfer.id
    });

    const saved: BatteryFundTransfer = { ...transfer, paymentId: payment.id, walletTxnId: txn.id };
    this.batteryFundTransfers.update(list => list.map(t => t.id === transfer.id ? saved : t));
    this.saveBatteryFundTransfers();
    return { ok: true, transfer: saved };
  }

  /** Oldest unpaid purchase first, so the fund clears the earliest bill. */
  private allocateBatteryFund(party: Party, amount: number): BatteryFundAllocation[] {
    const allocated = this.batteryFundAllocationsByVoucher();
    const rows = this.batteryPurchaseVouchers()
      .filter(v => this.partyForReference(v.partyId, v.partyName)?.id === party.id)
      .sort((a, b) =>
        (a.date || '').localeCompare(b.date || '')
        || (a.createdAt || '').localeCompare(b.createdAt || '')
        || a.id - b.id);
    const allocations: BatteryFundAllocation[] = [];
    let left = amount;
    for (const voucher of rows) {
      if (left <= 0.005) break;
      const free = this.roundMoney(Math.max(0, (Number(voucher.due) || 0) - (allocated.get(voucher.id) || 0)));
      if (free <= 0) continue;
      const take = this.roundMoney(Math.min(free, left));
      allocations.push({ voucherId: voucher.id, voucherNo: voucher.voucherNo, amount: take });
      left = this.roundMoney(left - take);
    }
    return allocations;
  }

  deleteBatteryFundTransfer(id: number) {
    const transfer = this.batteryFundTransfers().find(t => t.id === id);
    if (!transfer) return;
    // The receipt and wallet row belong to this transfer; reversing them here
    // restores the party due and the fund balance in one step.
    this.forceDeletePayment(transfer.paymentId);
    this.removeWalletTxn(transfer.walletTxnId);
    this.archive('sm_battery_fund_transfers_v1', 'ব্যাটারি ফান্ড ট্রান্সফার', transfer);
    this.batteryFundTransfers.update(list => list.filter(t => t.id !== id));
    this.saveBatteryFundTransfers();
  }

  /**
   * An Add Sale trade-in is a battery purchase settled against that invoice:
   * one linked purchase voucher per sale keeps the stock ledger and the bill in
   * step. Editing the sale updates it; removing the trade-in or the sale
   * removes it, so the old-battery stock never drifts from the voucher.
   */
  private syncSaleBatteryVoucher(sale: Sale, previous?: Sale) {
    const rows = (sale.batteryAdjustments ?? []).filter(b => (Number(b.total) || 0) > 0);
    const linkedId = previous?.batteryVoucherId ?? sale.batteryVoucherId;
    // A cancelled sale keeps no live trade-in voucher; its battery rows stay on
    // the sale so reactivating can rebuild the voucher from them.
    if (sale.status === 'Cancelled') {
      if (linkedId != null && this.batteryVouchers().some(v => v.id === linkedId)) this.deleteBatteryVoucher(linkedId);
      return;
    }
    if (!rows.length) {
      if (linkedId != null) this.deleteBatteryVoucher(linkedId);
      if (sale.batteryVoucherId != null) {
        this.sales.update(list => list.map(s => s.id === sale.id ? { ...s, batteryVoucherId: undefined } : s));
        this.saveSales();
      }
      return;
    }

    const total = this.roundMoney(rows.reduce((sum, b) => sum + (Number(b.total) || 0), 0));
    const totalKg = this.roundMoney(rows.reduce((sum, b) => sum + (Number(b.weightKg) || 0), 0));
    const lines: BatteryLine[] = rows.map(b => {
      const kind = batteryKindByKey(b.kindKey);
      const unit: BatteryUnit = b.unit || (kind && kind.unit !== 'either' ? kind.unit : 'kg');
      return {
        kind: kind ? kind.bn : (b.description || 'অন্যান্য'),
        kindKey: b.kindKey || kind?.key,
        unit,
        kg: Number(b.weightKg) || 0,
        rate: Number(b.ratePerKg) || 0
      };
    });
    const partyId = this.partyForReference(sale.partyId, sale.customerName)?.id;
    const payload: Omit<BatteryVoucher, 'id' | 'voucherNo' | 'shareKey' | 'walletTxnIds'> = {
      type: 'purchase',
      date: sale.date,
      partyName: sale.customerName,
      partyId,
      lot: `OB-${sale.invoice}`,
      lines,
      totalKg,
      total,
      cash: 0,
      bank: 0,
      mobile: 0,
      mobileType: 'bKash',
      ref: sale.invoice,
      // The value was paid by settling the sale invoice, so nothing leaves the cash drawer.
      paid: total,
      due: 0,
      notes: `বিক্রয় ${sale.invoice} এর বিল সমন্বয় — পুরাতন ব্যাটারি`,
      preparedBy: sale.preparedBy || 'Admin',
      createdAt: new Date().toISOString(),
      source: 'sale-adjustment',
      saleInvoice: sale.invoice
    };

    if (linkedId != null && this.batteryVouchers().some(v => v.id === linkedId)) {
      this.updateBatteryVoucher(linkedId, payload);
      return;
    }
    const saved = this.addBatteryVoucher(payload);
    this.sales.update(list => list.map(s => s.id === sale.id ? { ...s, batteryVoucherId: saved.id } : s));
    this.saveSales();
  }

  /**
   * Dated stock movements derived from the vouchers: every purchase lot keeps
   * its own rate, sales and exchanges leave at the running average cost.
   * Rows are chronological so `balanceQty/balanceValue` are the running book.
   */
  batteryStockLedger(): BatteryStockRow[] {
    // Same ordering as the lot book: on an identical date and timestamp the
    // higher list index is the older voucher (the list is newest-first).
    const sorted = this.batteryVouchers()
      .map((voucher, index) => ({ voucher, index }))
      .sort((a, b) =>
        (a.voucher.date || '').localeCompare(b.voucher.date || '')
        || (a.voucher.createdAt || '').localeCompare(b.voucher.createdAt || '')
        || b.index - a.index)
      .map(entry => entry.voucher);
    const rows: BatteryStockRow[] = [];
    // Every kind keeps its own book of purchase lots; the balance is the value
    // of the lots still on hand, so sale costs and stock value always agree.
    const lots = new Map<string, { qty: number; rate: number }[]>();
    const bucketOf = (key: string) => {
      let entry = lots.get(key);
      if (!entry) {
        entry = [];
        lots.set(key, entry);
      }
      return entry;
    };
    const balance = (key: string) => {
      let qty = 0, value = 0;
      for (const lot of bucketOf(key)) {
        qty += lot.qty;
        value += lot.qty * lot.rate;
      }
      return { qty, value };
    };
    const avgOf = (key: string) => {
      const entry = balance(key);
      return entry.qty > 0 ? entry.value / entry.qty : 0;
    };
    const addLot = (key: string, qty: number, rate: number) => bucketOf(key).push({ qty, rate });
    const takeLots = (key: string, qty: number) => {
      let need = qty, cost = 0;
      for (const lot of bucketOf(key)) {
        if (need <= 0) break;
        const take = Math.min(need, lot.qty);
        cost += take * lot.rate;
        lot.qty -= take;
        need -= take;
      }
      return cost;
    };
    const push = (kindKey: string, row: Omit<BatteryStockRow, 'kindKey' | 'balanceQty' | 'balanceValue'>) => {
      const entry = balance(kindKey);
      rows.push({
        ...row,
        kindKey,
        balanceQty: Math.round(entry.qty * 100) / 100,
        balanceValue: this.roundMoney(entry.value)
      });
    };

    for (const v of sorted) {
      if (v.type === 'purchase') {
        for (const l of v.lines ?? []) {
          const inQty = Number(l.kg) || 0;
          if (inQty <= 0) continue;
          const kindKey = l.kindKey || l.kind || 'other';
          const rate = Number(l.rate) || 0;
          addLot(kindKey, inQty, rate);
          push(kindKey, {
            date: v.date,
            voucherNo: v.voucherNo,
            source: v.source === 'sale-adjustment' ? 'sale-adjustment' : 'purchase',
            partyName: v.partyName,
            kind: l.kind,
            unit: l.unit || 'kg',
            inQty,
            outQty: 0,
            rate,
            amount: this.roundMoney(inQty * rate)
          });
        }
      } else if (v.type === 'sale') {
        for (const l of v.lines ?? []) {
          const outQty = Number(l.kg) || 0;
          if (outQty <= 0) continue;
          const kindKey = l.kindKey || l.kind || 'other';
          const rate = Number(l.rate) || 0;
          // Sold kilograms leave the oldest lots first, carrying their own cost.
          takeLots(kindKey, outQty);
          push(kindKey, {
            date: v.date,
            voucherNo: v.voucherNo,
            source: 'sale',
            partyName: v.partyName,
            kind: l.kind,
            unit: l.unit || 'kg',
            inQty: 0,
            outQty,
            rate,
            amount: this.roundMoney(outQty * rate)
          });
        }
      } else {
        const received = Number(v.receivedKg) || 0;
        if (received > 0) {
          const rate = avgOf('exchange');
          addLot('exchange', received, rate);
          push('exchange', {
            date: v.date,
            voucherNo: v.voucherNo,
            source: 'exchange',
            partyName: v.partyName,
            kind: v.receivedCondition === 'usable' ? 'ভালো পুরোনো ব্যাটারি (প্রাপ্ত)' : 'স্ক্র্যাপ (প্রাপ্ত)',
            unit: 'kg',
            inQty: received,
            outQty: 0,
            rate: Math.round(rate * 100) / 100,
            amount: this.roundMoney(received * rate)
          });
        }
        const given = Number(v.givenKg) || 0;
        if (given > 0) {
          const rate = avgOf('exchange');
          takeLots('exchange', given);
          push('exchange', {
            date: v.date,
            voucherNo: v.voucherNo,
            source: 'exchange',
            partyName: v.partyName,
            kind: 'ভালো পুরোনো ব্যাটারি (দেওয়া)',
            unit: 'kg',
            inQty: 0,
            outQty: given,
            rate: Math.round(rate * 100) / 100,
            amount: this.roundMoney(given * rate)
          });
        }
      }
    }
    return rows;
  }

  /** Remaining quantity per battery kind, valued at the purchase lots still on hand. */
  batteryKindStock(): BatteryKindStock[] {
    const buckets = new Map<string, { label: string; units: Set<BatteryUnit>; inQty: number; outQty: number }>();
    const bucket = (key: string, label: string) => {
      let entry = buckets.get(key);
      if (!entry) {
        entry = { label, units: new Set(), inQty: 0, outQty: 0 };
        buckets.set(key, entry);
      }
      return entry;
    };

    for (const v of this.batteryVouchers()) {
      if (v.type === 'exchange') {
        const entry = bucket('exchange', 'বদল (ভালো / প্রাপ্ত)');
        entry.units.add('kg');
        entry.inQty += Number(v.receivedKg) || 0;
        entry.outQty += Number(v.givenKg) || 0;
        continue;
      }
      for (const l of v.lines ?? []) {
        const q = Number(l.kg) || 0;
        if (q <= 0) continue;
        const kind = batteryKindByKey(l.kindKey);
        const entry = bucket(l.kindKey || l.kind || 'other', kind?.bn || l.kind || 'অন্যান্য');
        entry.units.add(l.unit || 'kg');
        if (v.type === 'purchase') entry.inQty += q;
        else entry.outQty += q;
      }
    }

    const remaining = this.batteryLotBook().remaining;
    return [...buckets.entries()].map(([key, entry]) => {
      const qty = Math.round((entry.inQty - entry.outQty) * 100) / 100;
      // Leftover lots carry the purchase cost of exactly what is still in stock.
      const left = remaining.get(key) ?? remaining.get(entry.label);
      const value = left && qty > 0 && left.qty > 0
        ? this.roundMoney(Math.min(qty, left.qty) * (left.value / left.qty))
        : 0;
      const avgRate = qty > 0 ? value / qty : 0;
      const units = [...entry.units];
      return {
        key,
        label: entry.label,
        unit: units.length === 1 ? units[0] : 'mixed',
        qty,
        value,
        avgRate: Math.round(avgRate * 100) / 100
      };
    });
  }

  /**
   * Battery vouchers settle through the same wallet accounts as the rest of the
   * shop: a purchase pays out, a sale or exchange fee collects in. The posted
   * transaction ids are stored on the voucher so edits and deletes reverse exactly.
   */
  private postBatteryWallet(voucher: BatteryVoucher, direction: 1 | -1) {
    if (direction === -1) {
      const ids = new Set(voucher.walletTxnIds ?? []);
      if (ids.size) this.walletTransactions.update(list => list.filter(t => !ids.has(t.id)));
      return;
    }
    const legs: { amount: number; type: WalletAccount['type'] }[] = [
      { amount: voucher.cash || 0, type: 'Cash' },
      { amount: voucher.bank || 0, type: 'Bank' },
      { amount: voucher.mobile || 0, type: voucher.mobileType || 'bKash' }
    ];
    const flow: WalletTransaction['direction'] = voucher.type === 'purchase' ? 'Out' : 'In';
    const ids: number[] = [];
    for (const leg of legs) {
      const amount = this.roundMoney(leg.amount);
      if (amount <= 0) continue;
      const account = this.walletAccounts().find(a => a.type === leg.type && a.status === 'Enabled')
        ?? this.walletAccounts().find(a => a.type === leg.type);
      if (!account) continue;
      const txn = this.addWalletTransaction({
        date: voucher.date,
        direction: flow,
        accountId: account.id,
        amount,
        party: voucher.partyName,
        note: `${voucher.voucherNo} · পুরাতন ব্যাটারি`,
        source: 'Battery',
        refId: voucher.id
      });
      ids.push(txn.id);
    }
    this.batteryVouchers.update(list => list.map(v => v.id === voucher.id ? { ...v, walletTxnIds: ids } : v));
  }

  /**
   * A battery voucher is a credit document: its total/paid/due move the party's
   * book too, so old-battery dues sit with the rest of the ledger. A sale
   * trade-in settles inside its invoice and never posts here.
   */
  private postBatteryParty(voucher: BatteryVoucher, direction: 1 | -1) {
    if (voucher.source === 'sale-adjustment') return;
    const party = this.partyForReference(voucher.partyId, voucher.partyName);
    if (!party) return;
    const total = this.roundMoney(voucher.total || 0);
    const paid = this.roundMoney(voucher.paid || 0);
    const due = this.roundMoney(voucher.due != null ? voucher.due : total - paid);
    const side: PartySide = voucher.type === 'purchase' ? 'purchase' : 'sales';
    this.parties.update(list => list.map(p => p.id === party.id
      ? this.patchPartyAccount(p, side, {
          total: direction * total,
          paid: direction * paid,
          due: direction * due
        }, side === 'purchase' ? 'Supplier' : 'Customer')
      : p));
    this.saveParties();
    this.batteryVouchers.update(list => list.map(v => v.id === voucher.id ? { ...v, partyPosted: true } : v));
  }

  addObservation(input: Omit<Observation, 'id' | 'obsNo' | 'createdAt'>): Observation {
    const record: Observation = {
      ...input,
      id: this.newId(),
      obsNo: this.nextDocNo('OBS', this.observations().map(x => x.obsNo)),
      createdAt: new Date().toISOString()
    };
    this.observations.update(list => [record, ...list]);
    return record;
  }

  updateObservation(id: number, patch: Partial<Observation>) {
    this.observations.update(list => list.map(x => x.id === id ? { ...x, ...patch, id } : x));
  }

  deleteObservation(id: number) {
    this.archive('sm_observations_v1', 'পর্যবেক্ষণ', this.observations().find(x => x.id === id));
    this.observations.update(list => list.filter(x => x.id !== id));
  }

  addStaff(input: Omit<HrmStaff, 'id' | 'createdAt'>): HrmStaff {
    const record: HrmStaff = { ...input, id: this.newId(), createdAt: new Date().toISOString() };
    this.hrmStaff.update(list => [record, ...list]);
    return record;
  }

  updateStaff(id: number, patch: Partial<HrmStaff>) {
    this.hrmStaff.update(list => list.map(x => x.id === id ? { ...x, ...patch, id } : x));
    // An open advance follows the employee, not the spelling of the name.
    const name = (patch.name || '').trim();
    if (name) this.staffAdvances.update(list => list.map(a => a.staffId === id ? { ...a, staffName: name } : a));
  }

  deleteStaff(id: number) {
    this.archive('sm_hrm_staff_v1', 'স্টাফ', this.hrmStaff().find(x => x.id === id));
    // Attendance and leave rows belong to the employee; leaving them behind
    // would keep a deleted person in the summaries.
    this.attendance.update(list => list.filter(a => a.staffId !== id));
    this.hrmLeaves.update(list => list.filter(l => l.staffId !== id));
    this.hrmStaff.update(list => list.filter(x => x.id !== id));
  }

  // ------------------------------------------------------------------
  // Leave. An approved request owns one attendance row per day in its range,
  // so payroll, the attendance sheet and the summary all read the same data.
  // ------------------------------------------------------------------
  leaveDates(fromDate: string, toDate: string): string[] {
    const start = this.parseIsoDate(fromDate);
    const end = this.parseIsoDate(toDate);
    if (!start || !end || end.getTime() < start.getTime()) return [];
    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime() && dates.length < 366) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  addLeave(input: Omit<HrmLeave, 'id' | 'createdAt' | 'decidedAt'>): HrmLeave {
    const now = new Date().toISOString();
    const record: HrmLeave = {
      ...input,
      id: this.newId(),
      createdAt: now,
      decidedAt: input.status === 'Pending' ? '' : now
    };
    this.hrmLeaves.update(list => [record, ...list]);
    if (record.status === 'Approved') this.applyLeave(record);
    this.syncLeaveStatus(record.staffId);
    return record;
  }

  updateLeave(id: number, patch: Partial<HrmLeave>) {
    const old = this.hrmLeaves().find(l => l.id === id);
    if (!old) return;
    const next: HrmLeave = { ...old, ...patch, id };
    if (next.status !== old.status && next.status !== 'Pending') {
      next.decidedAt = new Date().toISOString();
    }
    // Re-run from scratch: dropping the rows first means changing the dates,
    // the employee or the paid/unpaid type can never leave stale days behind.
    this.clearLeave(old.id);
    this.hrmLeaves.update(list => list.map(l => l.id === id ? next : l));
    if (next.status === 'Approved') this.applyLeave(next);
    this.syncLeaveStatus(next.staffId);
    if (old.staffId !== next.staffId) this.syncLeaveStatus(old.staffId);
  }

  deleteLeave(id: number) {
    const old = this.hrmLeaves().find(l => l.id === id);
    if (!old) return;
    this.clearLeave(id);
    this.archive('sm_hrm_leaves_v1', 'ছুটি', old);
    this.hrmLeaves.update(list => list.filter(l => l.id !== id));
    this.syncLeaveStatus(old.staffId);
  }

  /** The approved leave covering that employee on that day, if any. */
  approvedLeaveOn(staffId: number, date: string): HrmLeave | undefined {
    return this.hrmLeaves().find(l => l.staffId === staffId && l.status === 'Approved'
      && l.fromDate <= date && l.toDate >= date);
  }

  /** Pending or approved leave that already covers part of the range. */
  overlappingLeave(staffId: number, fromDate: string, toDate: string, ignoreId?: number): HrmLeave | undefined {
    return this.hrmLeaves().find(l => l.staffId === staffId && l.id !== ignoreId
      && (l.status === 'Pending' || l.status === 'Approved')
      && l.fromDate <= toDate && l.toDate >= fromDate);
  }

  unpaidLeaveInMonth(staffId: number, month: string): number {
    const unpaid = new Set(this.hrmLeaves().filter(l => l.type === 'Unpaid').map(l => l.id));
    return this.attendance().filter(a => a.staffId === staffId
      && (a.date || '').startsWith(month) && !!a.leaveId && unpaid.has(a.leaveId)).length;
  }

  private applyLeave(leave: HrmLeave) {
    const status: AttendanceRecord['status'] = leave.type === 'Unpaid' ? 'Absent' : 'Leave';
    const note = `${leave.type === 'Unpaid' ? 'অবৈতনিক ছুটি' : 'ছুটি'}: ${leave.reason || leave.type}`;
    for (const date of this.leaveDates(leave.fromDate, leave.toDate)) {
      const existing = this.attendance().find(a => a.staffId === leave.staffId && a.date === date);
      // A real punch is stronger proof than the request, so worked days stay.
      if (existing && (existing.timeIn || existing.timeOut)) continue;
      if (existing) {
        this.attendance.update(list => list.map(a => a.id === existing.id
          ? { ...a, status, leaveId: leave.id, note: a.note || note } : a));
        continue;
      }
      const record: AttendanceRecord = {
        id: this.newId(),
        staffId: leave.staffId,
        staffCode: leave.staffCode,
        staffName: leave.staffName,
        date,
        timeIn: '',
        timeOut: '',
        method: 'Manual',
        status,
        leaveId: leave.id,
        note,
        createdAt: new Date().toISOString()
      };
      this.attendance.update(list => [record, ...list]);
    }
  }

  private clearLeave(leaveId: number) {
    const rows = this.attendance().filter(a => a.leaveId === leaveId);
    if (!rows.length) return;
    // Placeholder days disappear; a day that already has punches keeps its row.
    const drop = new Set(rows.filter(a => !a.timeIn && !a.timeOut).map(a => a.id));
    this.attendance.update(list => list
      .filter(a => !drop.has(a.id))
      .map(a => a.leaveId === leaveId
        ? { ...a, leaveId: undefined, status: a.status === 'Leave' || a.status === 'Absent' ? 'Present' : a.status }
        : a));
  }

  /** Mirrors today's approved leave onto the employee status badge. */
  private syncLeaveStatus(staffId: number) {
    const staff = this.hrmStaff().find(s => s.id === staffId);
    if (!staff) return;
    const today = localDateIso();
    const onLeave = !!this.approvedLeaveOn(staffId, today);
    if (onLeave && staff.status === 'Active') this.updateStaff(staffId, { status: 'On Leave' });
    else if (!onLeave && staff.status === 'On Leave') this.updateStaff(staffId, { status: 'Active' });
  }

  private parseIsoDate(value: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    if (!m) return null;
    const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // ------------------------------------------------------------------
  // Attendance, payroll and shop rent. Wages and rent leave the counter,
  // so each paid row owns a wallet "Out" entry and follows it on edit/delete.
  // ------------------------------------------------------------------
  addAttendance(input: Omit<AttendanceRecord, 'id' | 'createdAt'>): AttendanceRecord {
    const existing = this.attendance().find(a => a.staffId === input.staffId && a.date === input.date);
    if (existing) {
      const next: AttendanceRecord = { ...existing, ...input, id: existing.id };
      this.attendance.update(list => list.map(a => a.id === existing.id ? next : a));
      return next;
    }
    const record: AttendanceRecord = { ...input, id: this.newId(), createdAt: new Date().toISOString() };
    this.attendance.update(list => [record, ...list]);
    return record;
  }

  updateAttendance(id: number, patch: Partial<AttendanceRecord>) {
    this.attendance.update(list => list.map(a => a.id === id ? { ...a, ...patch, id } : a));
  }

  deleteAttendance(id: number) {
    this.archive('sm_attendance_v1', 'হাজিরা', this.attendance().find(a => a.id === id));
    this.attendance.update(list => list.filter(a => a.id !== id));
  }

  attendanceInMonth(month: string): AttendanceRecord[] {
    return this.attendance().filter(a => (a.date || '').startsWith(month));
  }

  salaryPaidFor(staffId: number, month: string): SalaryPayment | undefined {
    return this.salaryPayments().find(p => p.staffId === staffId && p.month === month);
  }

  addSalaryPayment(input: Omit<SalaryPayment, 'id' | 'voucherNo' | 'createdAt' | 'walletTxnId' | 'advanceAllocations'>): SalaryPayment {
    const record: SalaryPayment = {
      ...input,
      id: this.newId(),
      voucherNo: this.nextDocNo('SAL', this.salaryPayments().map(p => p.voucherNo)),
      createdAt: new Date().toISOString()
    };
    record.advanceAllocations = this.recoverAdvanceFor(record.staffId, record.staffName, record.advanceAdjusted);
    // A salary fully offset by an advance moves no cash, so it posts no wallet row.
    if (record.netPay > 0) {
      record.walletTxnId = this.postWalletOut({
        date: record.date,
        amount: record.netPay,
        accountId: record.accountId,
        party: record.staffName,
        note: `বেতন ${record.month} (${record.voucherNo})`,
        source: 'Salary',
        refId: record.id
      });
    }
    this.salaryPayments.update(list => [record, ...list]);
    return record;
  }

  deleteSalaryPayment(id: number) {
    const old = this.salaryPayments().find(p => p.id === id);
    if (!old) return;
    this.reverseAdvanceAllocations(old.advanceAllocations);
    this.removeWalletTxn(old.walletTxnId);
    this.archive('sm_salary_payments_v1', 'বেতন', old);
    this.salaryPayments.update(list => list.filter(p => p.id !== id));
  }

  /** Oldest advance first, the same order the staff-advance page lists them. */
  private recoverAdvanceFor(staffId: number | undefined, staffName: string | undefined, amount: number): { advanceId: number; amount: number }[] {
    const allocations: { advanceId: number; amount: number }[] = [];
    let remaining = this.roundMoney(amount);
    if (remaining <= 0) return allocations;
    const open = this.staffAdvances()
      .filter(a => this.advanceBelongsTo(a, staffId, staffName))
      .filter(a => a.status !== 'Cancelled' && a.status !== 'Recovered')
      .filter(a => (a.recoveredAmount || 0) < a.amount)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    for (const advance of open) {
      if (remaining <= 0) break;
      const due = this.roundMoney(advance.amount - (advance.recoveredAmount || 0));
      const take = Math.min(due, remaining);
      this.recoverStaffAdvance(advance.id, take);
      allocations.push({ advanceId: advance.id, amount: take });
      remaining = this.roundMoney(remaining - take);
    }
    return allocations;
  }

  private reverseAdvanceAllocations(allocations?: { advanceId: number; amount: number }[]) {
    if (!allocations?.length) return;
    for (const alloc of allocations) {
      this.staffAdvances.update(list => list.map(a => a.id !== alloc.advanceId ? a : {
        ...a,
        recoveredAmount: Math.max(0, this.roundMoney((a.recoveredAmount || 0) - alloc.amount)),
        status: a.status === 'Recovered' ? 'Approved' : a.status
      }));
    }
  }

  addRentPayment(input: Omit<RentPayment, 'id' | 'voucherNo' | 'createdAt' | 'walletTxnId'>): RentPayment {
    const record: RentPayment = {
      ...input,
      id: this.newId(),
      voucherNo: this.nextDocNo('RENT', this.rentPayments().map(r => r.voucherNo)),
      createdAt: new Date().toISOString()
    };
    record.walletTxnId = this.postWalletOut({
      date: record.date,
      amount: record.amount,
      accountId: record.status === 'Paid' ? record.accountId : undefined,
      party: record.title || 'দোকান ভাড়া',
      note: `ভাড়া ${record.month}`,
      source: 'Rent',
      refId: record.id
    });
    this.rentPayments.update(list => [record, ...list]);
    return record;
  }

  updateRentPayment(id: number, patch: Partial<RentPayment>) {
    const old = this.rentPayments().find(r => r.id === id);
    if (!old) return;
    const next: RentPayment = { ...old, ...patch, id, walletTxnId: old.walletTxnId };
    next.walletTxnId = this.postWalletOut({
      txnId: old.walletTxnId,
      date: next.date,
      amount: next.amount,
      accountId: next.status === 'Paid' ? next.accountId : undefined,
      party: next.title || 'দোকান ভাড়া',
      note: `ভাড়া ${next.month}`,
      source: 'Rent',
      refId: id
    });
    this.rentPayments.update(list => list.map(r => r.id === id ? next : r));
  }

  deleteRentPayment(id: number) {
    const old = this.rentPayments().find(r => r.id === id);
    if (!old) return;
    this.removeWalletTxn(old.walletTxnId);
    this.archive('sm_rent_payments_v1', 'দোকান ভাড়া', old);
    this.rentPayments.update(list => list.filter(r => r.id !== id));
  }

  addOnlineRequest(input: Omit<OnlineRequest, 'id' | 'requestNo' | 'createdAt'>): OnlineRequest {
    const record: OnlineRequest = {
      ...input,
      id: this.newId(),
      requestNo: this.nextDocNo('ORE', this.onlineRequests().map(x => x.requestNo)),
      createdAt: new Date().toISOString()
    };
    this.onlineRequests.update(list => [record, ...list]);
    return record;
  }

  updateOnlineRequest(id: number, patch: Partial<OnlineRequest>) {
    this.onlineRequests.update(list => list.map(x => x.id === id ? { ...x, ...patch, id } : x));
  }

  deleteOnlineRequest(id: number) {
    this.archive('sm_online_requests_v1', 'অনলাইন রিকোয়েস্ট', this.onlineRequests().find(x => x.id === id));
    this.onlineRequests.update(list => list.filter(x => x.id !== id));
  }

  addDamageRecord(input: Omit<DamageRecord, 'id' | 'damageNo' | 'createdAt'>): DamageRecord {
    const record: DamageRecord = {
      ...input,
      id: this.newId(),
      damageNo: this.nextDocNo('DMG', this.damageRecords().map(x => x.damageNo)),
      createdAt: new Date().toISOString()
    };
    this.damageRecords.update(list => [{ ...record, ...this.applyDamageStock(record, 1) }, ...list]);
    return record;
  }

  updateDamageRecord(id: number, patch: Partial<DamageRecord>) {
    const old = this.damageRecords().find(x => x.id === id);
    if (!old) return;
    if (old.stockDeducted) this.applyDamageStock(old, -1);
    const next: DamageRecord = { ...old, ...patch, id };
    const applied = this.applyDamageStock(next, 1);
    this.damageRecords.update(list => list.map(x => x.id === id ? { ...next, ...applied } : x));
  }

  deleteDamageRecord(id: number) {
    const old = this.damageRecords().find(x => x.id === id);
    if (!old) return;
    if (old.stockDeducted) this.applyDamageStock(old, -1);
    this.archive('sm_damage_records_v1', 'ড্যামেজ', old);
    this.damageRecords.update(list => list.filter(x => x.id !== id));
  }

  /** Damaged goods leave the warehouse, so stock follows the record unless it is only reported. */
  private applyDamageStock(record: DamageRecord, sign: 1 | -1): Pick<DamageRecord, 'stockDeducted'> {
    const shouldDeduct = sign === 1 && record.status !== 'Reported' && !record.stockDeducted;
    const shouldRestore = sign === -1 && record.stockDeducted;
    if (!shouldDeduct && !shouldRestore) return { stockDeducted: record.stockDeducted };
    const key = (record.productName || '').trim();
    const quantity = (record.quantity || 0) * (shouldRestore ? 1 : -1);
    const apply = (stock: number) => Math.round(((stock || 0) + quantity) * 100) / 100;
    // Variant stock lives in variant.openingStock and the parent's stock is the
    // aggregate, so a variant line moves both. Legacy rows carry only the
    // "Parent - Variant" label, which is matched back to its variant here.
    const variantOf = (p: Product) => record.variantId != null
      ? p.variants?.find(v => v.id === record.variantId)
      : p.variants?.find(v => key === `${p.name} - ${v.variantValue}` || key === `${p.name} - ${v.variationName}`);
    this.products.update(list => list.map(p => {
      const variant = variantOf(p);
      if (variant) {
        return { ...p, stock: apply(p.stock),
          variants: p.variants!.map(v => v.id === variant.id ? { ...v, openingStock: apply(v.openingStock) } : v) };
      }
      return p.name.trim() === key ? { ...p, stock: apply(p.stock) } : p;
    }));
    return { stockDeducted: shouldDeduct };
  }

  updateSupplierReturn(id: number, patch: Partial<SupplierReturn>) {
    const old = this.supplierReturns().find(x => x.id === id);
    if (!old) throw new Error('Supplier return not found.');
    const next: SupplierReturn = { ...old, ...patch, id };
    this.preflightInventory(['supplier', old, -1], ['supplier', next, 1]);
    if (this.supplierReturnPosts(old.status)) {
      this.parties.update(list => list.map(p => p.id === old.partyId
        ? this.patchPartyAccount(p, 'purchase', { due: old.amount })
        : p));
      this.postSupplierReturnStock(old, -1);
    }
    this.supplierReturns.update(list => list.map(x => x.id === id ? next : x));
    if (this.supplierReturnPosts(next.status)) {
      this.parties.update(list => list.map(p => p.id === next.partyId
        ? this.patchPartyAccount(p, 'purchase', { due: -next.amount })
        : p));
      this.postSupplierReturnStock(next, 1);
    }
    this.saveSupplierReturns();
    this.saveParties();
  }

  deleteSupplierReturn(id: number) {
    const old = this.supplierReturns().find(x => x.id === id);
    if (!old) return;
    this.preflightInventory(['supplier', old, -1]);
    if (this.supplierReturnPosts(old.status)) {
      this.parties.update(list => list.map(p => p.id === old.partyId
        ? this.patchPartyAccount(p, 'purchase', { due: old.amount })
        : p));
      this.postSupplierReturnStock(old, -1);
    }
    this.archive('sm_supplier_returns_v1', 'ডেবিট নোট', old);
    this.supplierReturns.update(list => list.filter(x => x.id !== id));
    this.saveSupplierReturns();
    this.saveParties();
  }

  /** Edits a receipt in place: the old ledger effect is reversed, the new one applied. */
  updatePayment(id: number, patch: { amount?: number; discount?: number; mode?: LedgerPayment['mode']; date?: string; note?: string }): LedgerPayment | null {
    const old = this.payments().find(p => p.id === id);
    if (!old || old.batteryFundTransferId != null) return null;
    this.archive('sm_payments_v1', 'পেমেন্ট', old);
    const side: PartySide = old.partyType === 'Supplier' ? 'purchase' : 'sales';
    const oldAdvance = this.roundMoney(old.advance || 0);
    const oldSettlement = this.roundMoney(Math.max(0, (old.amount || 0) + (old.discount || 0) - oldAdvance));
    this.parties.update(list => list.map(p => p.id === old.partyId
      ? this.patchPartyAccount(p, side, { paid: -old.amount, due: oldSettlement, advance: -oldAdvance })
      : p));
    const amount = this.roundMoney(patch.amount ?? old.amount);
    const discount = this.roundMoney(patch.discount ?? old.discount);
    const party = this.parties().find(p => p.id === old.partyId);
    const book = party ? this.sideAccount(party, side) : { total: 0, paid: 0, due: 0, advance: 0 };
    const settlement = this.roundMoney(Math.min(Math.max(0, book.due), amount + discount));
    const advance = this.roundMoney(amount + discount - settlement);
    const next: LedgerPayment = {
      ...old,
      ...patch,
      amount,
      discount,
      advance,
      note: patch.note ?? old.note,
      date: patch.date ?? old.date,
      mode: patch.mode ?? old.mode
    };
    this.payments.update(list => list.map(p => (p.id === id ? next : p)));
    this.parties.update(list => list.map(p => p.id === old.partyId
      ? this.patchPartyAccount(p, side, { paid: amount, due: -settlement, advance }, side === 'purchase' ? 'Supplier' : 'Customer')
      : p));
    this.savePayments();
    this.saveParties();
    return next;
  }

  deletePayment(id: number) {
    const old = this.payments().find(x => x.id === id);
    if (!old || old.batteryFundTransferId != null) return;
    this.forceDeletePayment(id);
  }

  /** Used by the owning battery-fund transfer, which is allowed to reverse its receipt. */
  private forceDeletePayment(id?: number) {
    if (id == null) return;
    const old = this.payments().find(x => x.id === id);
    if (!old) return;
    const advance = this.roundMoney(old.advance || 0);
    const settlement = this.roundMoney(Math.max(0, (old.amount || 0) + (old.discount || 0) - advance));
    this.archive('sm_payments_v1', 'পেমেন্ট', old);
    this.payments.update(list => list.filter(x => x.id !== id));
    const side: PartySide = old.partyType === 'Supplier' ? 'purchase' : 'sales';
    this.parties.update(list => list.map(p => p.id === old.partyId
      ? this.patchPartyAccount(p, side, { paid: -old.amount, due: settlement, advance: -advance })
      : p));
    this.savePayments();
    this.saveParties();
  }

  // EXCEL / XLSX Export Engine
  exportToExcel(data: any[], filename: string) {
    if (!data || !data.length) {
      this.notify.warning(this.prefs.txt('এক্সপোর্ট করার মতো কোনো ডেটা নেই।', 'No data available to export.'));
      return;
    }
    void downloadWorkbook(`${filename}_${localDateIso()}.xlsx`, [
      { name: 'Sheet1', rows: data.map(row => this.flatRow(row)) }
    ]).catch(error => this.notify.error(error instanceof Error ? error.message : String(error), this.prefs.txt('এক্সপোর্ট ব্যর্থ', 'Export failed')));
  }

  /** Line items and payment schedules would otherwise land as `[object Object]`. */
  private flatRow(row: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries((row ?? {}) as Record<string, unknown>)) {
      out[key] = this.flatCell(value);
    }
    return out;
  }

  private flatCell(value: unknown): unknown {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toLocaleString('en-GB');
    if (typeof value === 'string') return value.startsWith('data:') ? '' : value;
    if (Array.isArray(value)) return value.map(item => this.flatCell(item)).join('; ');
    if (typeof value === 'object') {
      const item = value as Record<string, unknown>;
      const named = this.itemText(item);
      if (named) return named;
      return Object.entries(item)
        .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
        .map(([k, v]) => `${k}: ${v}`)
        .join(' ');
    }
    return value;
  }

  /** `SF Battery 100AH ×4 = 24800` reads far better than a JSON dump. */
  private itemText(item: Record<string, unknown>): string {
    const name = item['productName'] ?? item['name'] ?? item['title'] ?? item['description'] ?? item['product'];
    if (typeof name !== 'string' || !name) return '';
    const quantity = item['quantity'] ?? item['qty'];
    const amount = item['total'] ?? item['amount'] ?? item['value'];
    const parts = [name];
    if (quantity !== undefined && quantity !== null && quantity !== '') parts.push(`×${quantity}`);
    if (amount !== undefined && amount !== null && amount !== '') parts.push(`=${amount}`);
    return parts.join(' ');
  }

  // EXCEL / XLSX Export Engine with 39 exact headers matching image_8be5d8eb.png
  exportProductsToExcel(products: Product[], filename = 'Products_Master_List') {
    if (!products || !products.length) {
      this.notify.warning(this.prefs.txt('এক্সপোর্ট করার মতো কোনো পণ্যের ডেটা নেই।', 'No product data available to export.'));
      return;
    }

    const formattedData = products.map((p, idx) => ({
      'SL': idx + 1,
      'Product Name': p.name || '',
      'Item Code / SKU': p.code || '',
      'Product Type': p.type === 'single' ? 'Single Type Product' : p.type === 'variant' ? 'Variant Type Product' : 'Service Type Product',
      'Category': p.category || '',
      'Sub-Category': p.subCategory || '',
      'Brand': p.brand || '',
      'Product Model': p.model || '',
      'Barcode Symbology': p.barcodeSymbology || 'CODE128',
      'Unit': p.unit || 'পিস',
      'Purchase Price (BDT)': p.purchasePrice || 0,
      'Sales Price (BDT)': p.salesPrice || 0,
      'MRP (BDT)': p.mrp || 0,
      'Wholesale Price (BDT)': p.wholesalePrice || 0,
      'Wholesale Min Qty': p.wholesaleQuantity ?? '',
      'Current Stock': p.stock || 0,
      'Opening Stock': p.openingStock || 0,
      'Damaged Stock': 0,
      // the sheet's Alert Quantity column is what the form calls "quantity alert" = minQty
      'Alert Quantity': p.minQty ?? '',
      'Stock Valuation (Cost)': (p.stock || 0) * (p.purchasePrice || 0),
      'Stock Valuation (Sales)': (p.stock || 0) * (p.salesPrice || 0),
      'Tax Name': p.tax ? `VAT ${p.tax}%` : 'No Tax',
      'Tax Rate (%)': p.tax || 0,
      // the UI stores 'with'/'without'; the sheet uses the words the reference template shows
      'Purchase Tax Type': this.taxModeText(p.purchaseTaxMode),
      'Sales Tax Type': this.taxModeText(p.salesTaxMode),
      'Warranty Period': 'N/A',
      'Rack / Shelf No': p.rack || '',
      'Color': '',
      'Size': '',
      'Engine No': '',
      'Chassis No': '',
      'Has Serial No': 'No',
      'Has SIM No': 'No',
      'Has Vehicle Details': 'No',
      'Has Expiry Date': 'No',
      'Warehouse': p.warehouse || '',
      'Description': '',
      'Created Date': localDateIso(),
      // A base64 picture would blow past Excel's cell limit and come back truncated,
      // so the sheet carries only hosted URLs. The JSON backup keeps the local pictures.
      'Image URL': this.sheetImage(p.image)
    }));

    void downloadWorkbook(`${filename}_${localDateIso()}.xlsx`, [
      { name: 'Products', rows: formattedData }
    ]).catch(error => this.notify.error(error instanceof Error ? error.message : String(error), this.prefs.txt('এক্সপোর্ট ব্যর্থ', 'Export failed')));
  }

  /** Only hosted pictures survive a spreadsheet; a device-local data URL would not. */
  private sheetImage(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!/^https?:\/\//i.test(text)) return '';
    // The old catalog has a few file URLs in its picture column (product_x.xlsx);
    // they render as broken images, so treat them as "no picture".
    return /\.(xlsx?|csv|pdf|docx?|zip|rar|7z)(\?|#|$)/i.test(text) ? '' : text;
  }

  private taxModeText(mode: unknown): string {
    const value = String(mode ?? '');
    if (value === 'with') return 'With Tax';
    if (value === 'without') return 'Without Tax';
    // shop data imported from other systems carries its own words (Exclusive/Inclusive)
    return value;
  }

  /** Back to the value the product form's select understands, or the original word. */
  private taxModeValue(text: string): string | undefined {
    const t = (text || '').trim();
    if (!t) return undefined;
    const key = t.toLowerCase();
    if (key === 'with' || key === 'with tax' || key === 'withtax') return 'with';
    if (key === 'without' || key === 'without tax' || key === 'withouttax') return 'without';
    return t;
  }

  // EXCEL / XLSX Import Engine
  private async readSheet(file: File): Promise<Record<string, unknown>[]> {
    try {
      return this.gridRows(await readSpreadsheetGrid(file));
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Catalog exports from other systems start with a title line and a meta line,
   * so the first grid row is not always the header. Find the row that actually
   * names the columns and read the sheet from there.
   */
  private gridRows(grid: string[][]): Record<string, unknown>[] {
    let headerIndex = -1;
    for (let i = 0; i < Math.min(grid.length, 12); i++) {
      const cells = (grid[i] ?? []).map(cell => this.normalizeHeader(String(cell ?? '')));
      if (cells.includes('productname') || cells.includes('partyname') || cells.includes('itemcode') || cells.includes('itemcodesku')) {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex < 0) headerIndex = 0;
    const headers = (grid[headerIndex] ?? []).map(cell => String(cell ?? '').trim());
    const rows: Record<string, unknown>[] = [];
    for (const cells of grid.slice(headerIndex + 1)) {
      const row: Record<string, unknown> = {};
      let blank = true;
      headers.forEach((header, index) => {
        if (!header) return;
        const value = cells?.[index] ?? '';
        if (String(value).trim()) blank = false;
        row[header] = value;
      });
      if (!blank) rows.push(row);
    }
    return rows;
  }

  private cellText(row: Record<string, unknown>, keys: string[]): string {
    for (const [raw, value] of Object.entries(row)) {
      const key = this.normalizeHeader(raw);
      if (key && keys.includes(key)) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') continue;
        return String(value).trim();
      }
    }
    return '';
  }

  private cellNumber(row: Record<string, unknown>, keys: string[], fallback = 0): number {
    const text = this.cellText(row, keys).replace(/[৳,\s]|TK|BDT/gi, '');
    const value = Number(text);
    return Number.isFinite(value) ? value : fallback;
  }

  /** Catalog exports write an em dash in empty cells; it must not become a master record. */
  private textCell(row: Record<string, unknown>, keys: string[]): string {
    const value = this.cellText(row, keys);
    return /^[—–-]+$/.test(value) ? '' : value;
  }

  /** "1 Year" / "6 Months" / "90" -> days, so the product form's warranty field works. */
  private warrantyDaysFromSheet(row: Record<string, unknown>): number | undefined {
    const text = this.textCell(row, ['warrantyperiod', 'warranty', 'warrantydays']);
    if (!text) return undefined;
    const amount = Number(/(\d+(?:\.\d+)?)/.exec(text)?.[1]);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const lower = text.toLowerCase();
    if (/year|বছর|yr/.test(lower)) return Math.round(amount * 365);
    if (/month|মাস/.test(lower)) return Math.round(amount * 30);
    return Math.round(amount);
  }

  private normalizeHeader(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09ff]/g, '')
      .replace(/(bdt|taka|tk)$/, '');
  }

  private nextRecordId(list: { id: number }[]): number {
    return list.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  }

  /** Reads a catalogue and reports what would change, without touching the shop. */
  async analyzeProductImport(file: File): Promise<ProductImportSummary> {
    const built = this.buildProductImport(await this.readSheet(file));
    return this.importSummary(built, this.planTaxonomy(built.merged));
  }

  /** Existing item codes win so a re-import updates rows instead of duplicating them. */
  async importProducts(file: File): Promise<ProductImportSummary> {
    const built = this.buildProductImport(await this.readSheet(file));
    const taxonomy = this.planTaxonomy(built.merged);
    if (built.added.length || built.updated) this.products.update(() => built.merged);
    this.commitProductTaxonomy(taxonomy);
    return this.importSummary(built, taxonomy);
  }

  private importSummary(built: BuiltProductImport, taxonomy: PlannedTaxonomy): ProductImportSummary {
    return {
      totalRows: built.totalRows,
      added: built.added.length,
      updated: built.updated,
      skipped: built.skipped,
      variants: built.variants,
      newCategories: taxonomy.newCategories.map(row => row.name),
      newSubCategories: taxonomy.newSubCategories.map(row => row.name),
      newBrands: taxonomy.newBrands.map(row => row.name),
      newModels: taxonomy.newModels.map(row => row.name),
      warnings: built.warnings
    };
  }

  private buildProductImport(rows: Record<string, unknown>[]): BuiltProductImport {
    const list = this.products().map(p => ({ ...p }));
    const byCode = new Map(list.map(p => [String(p.code).trim().toLowerCase(), p]));
    const added: Product[] = [];
    let updated = 0;
    let skipped = 0;
    let variants = 0;
    let totalRows = 0;
    let footerRows = 0;
    let missingCode = 0;
    const warnings: string[] = [];
    const seenCodes = new Set<string>();
    const repeatedCodes = new Set<string>();
    /** Catalog sheets list a "Variable (Parent)" row followed by its "↳ Variation Item" rows. */
    let parent: Product | null = null;

    const lowestPositive = (values: number[]) => {
      const positives = values.filter(value => value > 0);
      return positives.length ? Math.min(...positives) : 0;
    };

    const closeParent = () => {
      if (!parent) return;
      const parentVariants = parent.variants ?? [];
      if (parentVariants.length) {
        const stock = this.roundMoney(parentVariants.reduce((sum, v) => sum + (Number(v.openingStock) || 0), 0));
        parent.type = 'variant';
        parent.stock = stock;
        parent.openingStock = stock;
        parent.salesPrice = lowestPositive(parentVariants.map(v => v.salesPrice));
        parent.purchasePrice = lowestPositive(parentVariants.map(v => v.purchasePrice));
        parent.wholesalePrice = lowestPositive(parentVariants.map(v => v.wholesalePrice));
        parent.mrp = lowestPositive(parentVariants.map(v => v.mrp ?? 0));
      }
      parent = null;
    };

    for (const row of rows) {
      const rawName = this.cellText(row, ['productname', 'name', 'product', 'pnamesm', 'পণ্যেরনাম', 'নাম']);
      if (!rawName) {
        skipped++;
        continue;
      }
      // Exporters end the sheet with a "TOTAL CONSOLIDATED (n ITEMS)" line; it is
      // a report footer, not a product. A real product may still be named "Total ...".
      if (/^total\s+consolidated\b/i.test(rawName.trim())) {
        footerRows++;
        continue;
      }
      totalRows++;
      const typeRaw = this.cellText(row, ['producttype', 'type']).toLowerCase();
      const isVariationRow = typeRaw.includes('variation') || /^\s*↳/.test(rawName);
      if (isVariationRow && parent) {
        const variant = this.variantFromSheet(row, rawName);
        const existingVariants = parent.variants ?? [];
        const match = variant.itemCode
          ? existingVariants.findIndex(v => String(v.itemCode) === String(variant.itemCode))
          : -1;
        parent.variants = match >= 0
          ? existingVariants.map((v, index) => (index === match ? { ...v, ...variant, id: v.id } : v))
          : [...existingVariants, variant];
        variants++;
        continue;
      }
      closeParent();

      const name = rawName.replace(/^\s*↳\s*/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim() || rawName;
      const type: Product['type'] =
        typeRaw.includes('variant') || typeRaw.includes('variable') ? 'variant'
          : typeRaw.includes('service') ? 'service' : 'single';
      const image = this.sheetImage(this.cellText(row, ['imageurl', 'image', 'photo']));
      // Catalog exports write an em dash for "not set"; it must not become a master record.
      const rackCell = this.textCell(row, ['rackshelfno', 'rack']);
      const warrantyDays = this.warrantyDaysFromSheet(row);
      const patch: Partial<Product> = {
        name,
        type,
        category: this.textCell(row, ['category', 'cat', 'ক্যাটাগরি']) || 'সাধারণ',
        subCategory: this.textCell(row, ['subcategory', 'sub']) || undefined,
        brand: this.textCell(row, ['brand', 'brandname', 'ব্র্যান্ড']) || 'Unknown',
        model: this.textCell(row, ['productmodel', 'model', 'মডেল']) || 'All Model',
        // a sheet without a rack column must not erase the rack the product already has
        ...(rackCell ? { rack: rackCell } : {}),
        warehouse: this.textCell(row, ['warehouse']) || undefined,
        unit: this.textCell(row, ['unit', 'পিস']) || 'পিস',
        stock: this.cellNumber(row, ['currentstock', 'stock', 'qty', 'quantity', 'স্টক']),
        openingStock: this.cellNumber(row, ['openingstock', 'opening']),
        salesPrice: this.cellNumber(row, ['salesprice', 'saleprice', 'sellingprice', 'বিক্রয়মূল্য']),
        purchasePrice: this.cellNumber(row, ['purchaseprice', 'buypurchase', 'costprice', 'ক্রয়মূল্য']),
        wholesalePrice: this.cellNumber(row, ['wholesaleprice', 'wholesale']),
        mrp: this.cellNumber(row, ['mrp', 'marketprice']),
        tax: this.cellNumber(row, ['taxrate', 'tax']),
        minQty: this.cellNumber(row, ['alertquantity', 'minqty', 'alertqty', 'alert'], 5),
        wholesaleQuantity: this.cellNumber(row, ['wholesaleminqty', 'wholesaleqty']),
        barcodeSymbology: this.cellText(row, ['barcodesymbology', 'barcode']) || 'CODE128',
        purchaseTaxMode: this.taxModeValue(this.cellText(row, ['purchasetaxtype', 'purchasetaxmode'])),
        salesTaxMode: this.taxModeValue(this.cellText(row, ['salestaxtype', 'salestaxmode'])),
        ...(warrantyDays ? { warrantyDays } : {}),
        // a sheet with no picture column must not erase the picture the product already has
        ...(image ? { image } : {})
      };

      const code = this.cellText(row, ['itemcodesku', 'itemcode', 'code', 'sku', 'আইটেমকোড']);
      if (!code) {
        missingCode++;
      } else if (seenCodes.has(code.toLowerCase())) {
        repeatedCodes.add(code);
      } else {
        seenCodes.add(code.toLowerCase());
      }
      const existing = code ? byCode.get(code.toLowerCase()) : list.find(p => p.name === name);
      if (existing) {
        if (code) patch.code = code;
        Object.assign(existing, patch);
        updated++;
        parent = type === 'variant' ? existing : null;
        continue;
      }
      let productCode = code;
      if (!productCode) {
        productCode = String(this.uniqueProductCode(list.length + added.length));
        while (byCode.has(productCode.toLowerCase())) productCode = String(Number(productCode) + 1);
      }
      const product: Product = {
        id: this.newId(),
        code: productCode,
        ...patch,
        rack: rackCell || 'WH-0',
      } as Product;
      added.push(product);
      byCode.set(String(product.code).toLowerCase(), product);
      parent = type === 'variant' ? product : null;
    }
    closeParent();

    if (missingCode) warnings.push(`${missingCode}টি সারিতে আইটেম কোড নেই — অ্যাপ স্বয়ংক্রিয় কোড দিয়েছে।`);
    if (repeatedCodes.size) warnings.push(`${repeatedCodes.size}টি আইটেম কোড ফাইলে একাধিকবার আছে — শেষ সারিটি আগেরটির ওপর আপডেট হয়েছে।`);
    if (footerRows) warnings.push(`${footerRows}টি টোটাল/সারসংক্ষেপ সারি বাদ দেওয়া হয়েছে।`);
    if (skipped) warnings.push(`${skipped}টি সারিতে পণ্যের নাম নেই — বাদ দেওয়া হয়েছে।`);

    return {
      merged: [...added, ...list],
      added,
      updated,
      skipped,
      variants,
      totalRows,
      warnings
    };
  }

  /**
   * A catalog sheet names its categories, brands, models and variations but
   * carries no rows for them, so the pickers stay empty until they are registered.
   */
  private planTaxonomy(products: Product[]): PlannedTaxonomy {
    const newCategories: Category[] = [];
    const newSubCategories: SubCategory[] = [];
    const newBrands: Brand[] = [];
    const newModels: ProductModel[] = [];

    const categoryNames = new Set(this.categories().map(c => this.normalizeKey(c.name)));
    const subKeys = new Set(this.subCategories().map(s => `${this.normalizeKey(s.parentCategory)}|${this.normalizeKey(s.name)}`));
    const brandNames = new Set(this.brands().map(b => this.normalizeKey(b.name)));
    const modelNames = new Set(this.productModels().map(m => this.normalizeKey(m.name)));
    const variations = new Map<string, { id: number; name: string; values: Set<string>; created: boolean }>();
    for (const variation of this.variations()) {
      variations.set(this.normalizeKey(variation.name), {
        id: variation.id,
        name: variation.name,
        values: new Set(parseVariationValues(variation.values)),
        created: false
      });
    }

    for (const product of products) {
      const category = (product.category || '').trim();
      if (category && !categoryNames.has(this.normalizeKey(category))) {
        categoryNames.add(this.normalizeKey(category));
        newCategories.push({ id: this.newId(), name: category, logo: '', productCount: 0, status: 'Enabled', subCategories: [] });
      }
      const subCategory = (product.subCategory || '').trim();
      if (category && subCategory) {
        const key = `${this.normalizeKey(category)}|${this.normalizeKey(subCategory)}`;
        if (!subKeys.has(key)) {
          subKeys.add(key);
          newSubCategories.push({
            id: this.newId(),
            name: subCategory,
            slug: this.normalizeKey(subCategory).replace(/\s+/g, '-'),
            parentCategory: category,
            logo: '',
            productCount: 0,
            status: 'Enabled'
          });
        }
      }
      const brand = (product.brand || '').trim();
      if (brand && brand !== 'Unknown' && !brandNames.has(this.normalizeKey(brand))) {
        brandNames.add(this.normalizeKey(brand));
        newBrands.push({ id: this.newId(), name: brand, logo: '', productCount: 0 });
      }
      for (const model of productModelsOf(product.model)) {
        if (model === 'All Model' || modelNames.has(this.normalizeKey(model))) continue;
        modelNames.add(this.normalizeKey(model));
        newModels.push({ id: this.newId(), name: model, logo: '' });
      }
      for (const variant of product.variants ?? []) {
        const name = (variant.variationName || '').trim();
        if (!name) continue;
        const key = this.normalizeKey(name);
        const known = variations.get(key);
        if (known) {
          known.values.add(variant.variantValue);
          variant.variationId = known.id;
        } else {
          const id = this.newId();
          variations.set(key, { id, name, values: new Set([variant.variantValue]), created: true });
          variant.variationId = id;
        }
      }
    }

    return {
      newCategories,
      newSubCategories,
      newBrands,
      newModels,
      createdVariations: [...variations.values()]
        .filter(v => v.created)
        .map(v => ({ id: v.id, name: v.name, values: [...v.values] }))
    };
  }

  private commitProductTaxonomy(plan: PlannedTaxonomy): void {
    if (plan.newCategories.length) this.categories.update(list => [...plan.newCategories, ...list]);
    if (plan.newSubCategories.length) this.subCategories.update(list => [...plan.newSubCategories, ...list]);
    if (plan.newBrands.length) this.brands.update(list => [...plan.newBrands, ...list]);
    if (plan.newModels.length) this.productModels.update(list => [...plan.newModels, ...list]);
    if (plan.createdVariations.length) {
      this.variations.update(list => [
        ...plan.createdVariations.map(v => ({ id: v.id, name: v.name, values: serializeVariationValues(v.values) })),
        ...list
      ]);
    }
  }

  /** One "↳ Name [Color: Red]" row of a variable-parent block. */
  private variantFromSheet(row: Record<string, unknown>, rawName: string): ProductVariant {
    const inside = /\[([^\]]*)\]/.exec(rawName)?.[1]?.trim() || '';
    const colon = inside.indexOf(':');
    const variationName = colon > 0 ? inside.slice(0, colon).trim() : 'Variant';
    const variantValue = (colon > 0 ? inside.slice(colon + 1) : inside).trim()
      || rawName.replace(/^\s*↳\s*/, '').trim();
    const current = this.cellText(row, ['currentstock', 'stock', 'qty', 'quantity']);
    const opening = this.cellText(row, ['openingstock', 'opening']);
    return {
      id: this.newId(),
      variationId: 0,
      variationName,
      variantValue,
      itemCode: this.cellText(row, ['itemcodesku', 'itemcode', 'code', 'sku', 'আইটেমকোড']),
      image: this.sheetImage(this.cellText(row, ['imageurl', 'image', 'photo'])) || undefined,
      quantityAlert: this.cellNumber(row, ['alertquantity', 'minqty', 'alert'], 5),
      mrp: this.cellNumber(row, ['mrp', 'marketprice']),
      tax: this.cellNumber(row, ['taxrate', 'tax']),
      purchasePrice: this.cellNumber(row, ['purchaseprice', 'buypurchase', 'costprice']),
      purchaseTaxType: this.taxModeValue(this.cellText(row, ['purchasetaxtype', 'purchasetaxmode'])),
      wholesalePrice: this.cellNumber(row, ['wholesaleprice', 'wholesale']),
      salesPrice: this.cellNumber(row, ['salesprice', 'saleprice', 'sellingprice']),
      salesTaxType: this.taxModeValue(this.cellText(row, ['salestaxtype', 'salestaxmode'])),
      wholesaleQuantity: this.cellNumber(row, ['wholesaleminqty', 'wholesaleqty']),
      // A variant's openingStock is the only per-variant quantity the app tracks,
      // so take the catalog's live figure and fall back to its opening column.
      openingStock: this.cellNumber(
        row,
        current !== '' ? ['currentstock', 'stock', 'qty', 'quantity'] : ['openingstock', 'opening']
      )
    };
  }

  private uniqueProductCode(seed: number): number {
    const used = new Set(this.products().map(p => String(p.code)));
    let code = 100000000 + seed;
    while (used.has(String(code))) code++;
    return code;
  }

  async importParties(file: File): Promise<{ added: number; updated: number; skipped: number }> {
    const rows = await this.readSheet(file);
    const list = this.parties().map(p => ({ ...p }));
    const byName = new Map(list.map(p => [p.name.trim().toLowerCase(), p]));
    const byPhone = new Map<string, Party>();
    for (const party of list) {
      for (const value of partyPhones(party)) {
        const key = partyPhoneKey(value);
        if (key && !byPhone.has(key)) byPhone.set(key, party);
      }
    }
    let nextId = this.nextRecordId(list);
    const added: Party[] = [];
    let updated = 0;
    let skipped = 0;
    const types: Party['type'][] = ['Customer', 'Corporate Customer', 'Supplier', 'Dealer', 'Staff Member'];

    for (const row of rows) {
      const name = this.cellText(row, ['name', 'partyname', 'customername', 'suppliername', '/carbari', 'নাম', 'কারবারি']);
      if (!name) {
        skipped++;
        continue;
      }
      const rawType = this.cellText(row, ['type', 'partytype', 'ধরন']);
      const type = types.find(t => t.toLowerCase() === rawType.toLowerCase()) ?? 'Customer';
      const statusRaw = this.cellText(row, ['status', 'অবস্থা']).toLowerCase();
      const phone = this.cellText(row, ['phone', 'mobile', 'mobileno', 'মোবাইল']) || undefined;
      const total = this.cellNumber(row, ['total', 'totalamount', 'মোট']);
      const paid = this.cellNumber(row, ['paid', 'paidamount', 'পরিশোধিত']);
      const due = this.cellNumber(row, ['due', 'dueamount', 'বাকি'], Math.max(0, total - paid));
      // Imported totals describe one book only, so they are written to the side
      // that matches the imported type instead of the mixed legacy columns.
      const accountPatch: Partial<Party> = type === 'Supplier'
        ? { roles: [type], purchaseTotal: total, purchasePaid: paid, purchaseDue: due, salesTotal: 0, salesPaid: 0, salesDue: 0 }
        : { roles: [type], salesTotal: total, salesPaid: paid, salesDue: due, purchaseTotal: 0, purchasePaid: 0, purchaseDue: 0 };
      const patch: Partial<Party> = {
        name,
        companyName: this.cellText(row, ['companyname', 'company', 'firm', 'প্রতিষ্ঠান']) || 'N/A',
        type,
        ...accountPatch,
        status: statusRaw === 'disabled' ? 'Disabled' : 'Enabled',
        zone: this.cellText(row, ['zone']) || '-',
        email: this.cellText(row, ['email', 'eail']) || '-',
        phone,
        address: this.cellText(row, ['address', 'ঠিকানা']) || '-',
        inHand: this.cellText(row, ['inhand']) || '0 Pcs',
        documents: this.cellText(row, ['documents']) || '-',
        nextPayment: this.cellText(row, ['nextpayment']) || '-',
        total,
        paid,
        due,
        ...(this.cellText(row, ['openingbalance', 'opening'])
          ? { openingBalance: this.cellNumber(row, ['openingbalance', 'opening']) }
          : {}),
        creditPeriod: this.cellNumber(row, ['creditperiod']) || undefined,
        creditLimit: this.cellNumber(row, ['creditlimit']) || undefined,
        remarks: this.cellText(row, ['remarks', 'note', 'নোট']) || undefined
      };

      const existing = byName.get(name.trim().toLowerCase());
      const phoneKey = partyPhoneKey(phone);
      const phoneOwner = phoneKey ? byPhone.get(phoneKey) : undefined;
      const legacyPhone = !!existing && partyPhones(existing).some(value => partyPhoneKey(value) === phoneKey);
      if (phoneOwner && phoneOwner !== existing && !legacyPhone) {
        // Importing a second party on the same subscriber would split its ledger.
        skipped++;
        continue;
      }
      if (existing) {
        for (const value of partyPhones(existing)) {
          const oldKey = partyPhoneKey(value);
          if (oldKey && byPhone.get(oldKey) === existing) byPhone.delete(oldKey);
        }
        Object.assign(existing, patch);
        if (phoneKey) byPhone.set(phoneKey, existing);
        updated++;
        continue;
      }
      const party: Party = {
        id: nextId++,
        createdAt: this.cellText(row, ['createdat', 'createddate', 'date']) || localDateIso(),
        ...patch,
      } as Party;
      added.push(party);
      byName.set(name.trim().toLowerCase(), party);
      if (phoneKey) byPhone.set(phoneKey, party);
    }

    if (added.length || updated) {
      this.parties.update(() => [...added, ...list].map(p => this.normalizeParty(p)));
    }
    this.saveParties();
    return { added: added.length, updated, skipped };
  }

  addPaymentToSale(saleId: number, paymentData: { amount: number; discount: number; paymentMode: string; notes: string; nextPaymentDate: string; paymentDate: string }) {
    const previous = this.sales().find(s => s.id === saleId);
    this.sales.update(list => list.map(s => {
      if (s.id === saleId) {
        const newPaid = (s.paid || 0) + paymentData.amount;
        const newDue = Math.max(0, s.total - newPaid - paymentData.discount);
        const newStatus = newDue <= 0 ? 'Paid' : (newPaid > 0 ? 'Partially Paid' : 'Unpaid');
        return {
          ...s,
          paid: newPaid,
          due: newDue,
          paymentStatus: newStatus,
          nextPayDate: paymentData.nextPaymentDate || s.nextPayDate
        };
      }
      return s;
    }));
    this.saveSales();

    if (previous && previous.status !== 'Cancelled') {
      const name = (previous.customerName || '').trim();
      const party = this.parties().find(p => p.name === name);
      if (party) {
        // The receipt is the accounting record: it drives party books, Payment-In and cash closing.
        this.recordPayment({
          partyId: party.id,
          partyName: party.name,
          partyType: 'Customer',
          amount: paymentData.amount,
          discount: paymentData.discount,
          mode: this.asLedgerMode(paymentData.paymentMode),
          date: paymentData.paymentDate || localDateIso(),
          note: paymentData.notes || `ইনভয়েস ${previous.invoice}-এর পেমেন্ট`
        });
      }
    }
  }

  private asLedgerMode(mode: string): LedgerPayment['mode'] {
    return (LEDGER_MODES as readonly string[]).includes(mode) ? mode as LedgerPayment['mode'] : 'Cash';
  }

  // ------------------------------------------------------------------
  // Recycle bin: every delete drops a snapshot here first, so a wrong
  // click can be undone without hunting a backup.
  // ------------------------------------------------------------------
  private archive(
    collection: string,
    kind: string,
    record: { id: number } | null | undefined,
    cascade?: RecycleEntry['cascade']
  ): void {
    if (!record) return;
    const fields = record as Record<string, unknown>;
    const rawTitle = fields['name'] ?? fields['invoice'] ?? fields['creditNoteNo'] ?? fields['returnNo']
      ?? fields['advanceNo'] ?? fields['quoteNo'] ?? fields['damageNo'] ?? fields['txnNo']
      ?? fields['requestNo'] ?? fields['title'] ?? fields['invoiceNumber'];
    this.recycleBin.update(list => [
      {
        id: this.newId(),
        collection,
        kind,
        title: rawTitle ? String(rawTitle) : `#${record.id}`,
        recordId: record.id,
        deletedAt: new Date().toISOString(),
        payload: record,
        cascade
      },
      ...list
    ].slice(0, DataService.RECYCLE_LIMIT));
  }

  restoreRecycle(entryId: number): 'restored' | 'missing' | 'duplicate' | 'blocked' {
    const entry = this.recycleBin().find(e => e.id === entryId);
    if (!entry) return 'missing';
    const target = this.collections().find(c => c.key === entry.collection);
    if (!target) return 'missing';
    const record = entry.payload as { id: number };
    if (target.signal().some((row: { id: number }) => row.id === record.id)) return 'duplicate';
    if (['sm_categories_v2', 'sm_sub_categories_v2', 'sm_brands_v2', 'sm_product_models_v2'].includes(entry.collection)) {
      const named = record as { name?: string; parentCategory?: string };
      const keyOf = (row: { name?: string; parentCategory?: string }) => entry.collection === 'sm_sub_categories_v2'
        ? `${this.normalizeKey(row.parentCategory)}|${this.normalizeKey(row.name)}`
        : this.normalizeKey(row.name);
      if ((target.signal() as { name?: string; parentCategory?: string }[]).some(row => keyOf(row) === keyOf(named))) return 'duplicate';
    }

    const kinds: Record<string, InventoryKind> = { sm_sales_v1: 'sale', sm_purchases_v1: 'purchase', sm_sales_returns_v1: 'credit', sm_supplier_returns_v1: 'supplier' };
    try {
      if (kinds[entry.collection]) this.preflightInventory([kinds[entry.collection], record as InventoryRecord, 1]);
    } catch { return 'blocked'; }
    const children: RecycleEntry[] = [];
    let restoredBattery: BatteryVoucher | null = null;
    if (entry.collection === 'sm_sales_v1') {
      const sale = record as Sale;
      for (const [collection, id] of [['sm_warranty_receipts_v1', sale.warrantyReceiptId], ['sm_battery_vouchers_v1', sale.batteryVoucherId]] as const) {
        if (id == null) continue;
        if (this.collections().find(c => c.key === collection)!.signal().some(r => r.id === id)) continue;
        const child = this.recycleBin().find(e => e.collection === collection && e.recordId === id);
        if (!child) return 'blocked';
        if (collection === 'sm_warranty_receipts_v1' && this.validateWarrantyReceipt(child.payload as WarrantyReceipt)) return 'blocked';
        children.push(child);
      }
    }

    // All dependency and net-stock checks precede any posting.
    switch (entry.collection) {
      case 'sm_warranty_receipts_v1': {
        const receipt = record as WarrantyReceipt;
        if (this.validateWarrantyReceipt(receipt)) return 'blocked';
        this.postWarrantyReceiptStock(receipt, 1);
        break;
      }
      case 'sm_warranty_replacements_v1': {
        const replacement = record as WarrantyReplacement;
        if (this.validateWarrantyReplacement(replacement)) return 'blocked';
        replacement.receiptPrevStatus = this.warrantyReceipts().find(r => r.id === replacement.receiptId)?.status;
        this.postWarrantyReplacement(replacement, 1);
        break;
      }
      case 'sm_sales_v1':
        Object.assign(record, this.invoiceDue(record as Sale));
        for (const child of children) {
          if (child.collection === 'sm_warranty_receipts_v1') {
            const receipt = child.payload as WarrantyReceipt;
            this.warrantyReceipts.update(rows => [receipt, ...rows]);
            this.postWarrantyReceiptStock(receipt, 1);
          } else {
            this.batteryVouchers.update(rows => [child.payload as BatteryVoucher, ...rows]);
            // The deleted chain reversed the wallet and party rows; put them back too.
            this.postBatteryWallet(child.payload as BatteryVoucher, 1);
            this.postBatteryParty(child.payload as BatteryVoucher, 1);
          }
        }
        this.postSale(record as Sale, 1);
        break;
      case 'sm_purchases_v1':
        this.postPurchaseStock(record as Purchase, 1);
        this.postPurchaseParty(record as Purchase, 1);
        break;
      case 'sm_sales_returns_v1': {
        const note = record as SalesReturn;
        if (note.status === 'Posted') {
          this.applyCreditNoteLedger(note, 1);
          if (note.restock) this.restockReturnedItems(note.items, 1);
        }
        break;
      }
      case 'sm_supplier_returns_v1': {
        const note = record as SupplierReturn;
        if (!this.supplierReturnPosts(note.status)) break;
        this.parties.update(list => list.map(p => p.id === note.partyId
          ? this.patchPartyAccount(p, 'purchase', { due: -note.amount })
          : p));
        this.postSupplierReturnStock(note, 1);
        break;
      }
      case 'sm_damage_records_v1':
        Object.assign(record, this.applyDamageStock(record as DamageRecord, 1));
        break;
      case 'sm_battery_vouchers_v1':
        restoredBattery = record as BatteryVoucher;
        break;
      case 'sm_payments_v1': {
        const payment = record as LedgerPayment;
        const advance = this.roundMoney(payment.advance || 0);
        const settlement = this.roundMoney(Math.max(0, (payment.amount || 0) + (payment.discount || 0) - advance));
        const side: PartySide = payment.partyType === 'Supplier' ? 'purchase' : 'sales';
        this.parties.update(list => list.map(p => p.id === payment.partyId
          ? this.patchPartyAccount(p, side, { paid: payment.amount, due: -settlement, advance })
          : p));
        break;
      }
    }

    target.signal.update(list => [record, ...list]);
    if (restoredBattery) {
      this.postBatteryWallet(restoredBattery, 1);
      this.postBatteryParty(restoredBattery, 1);
    }
    if (entry.cascade) {
      const side = this.collections().find(c => c.key === entry.cascade!.collection);
      side?.signal.update(rows => [...entry.cascade!.rows, ...rows]);
    }
    this.recycleBin.update(list => list.filter(e => e.id !== entryId && !children.some(c => c.id === e.id)));
    return 'restored';
  }

  purgeRecycle(entryId: number): void {
    this.recycleBin.update(list => list.filter(e => e.id !== entryId));
  }

  emptyRecycle(): void {
    this.recycleBin.set([]);
  }

  deleteSale(id: number) {
    const previous = this.sales().find(s => s.id === id);
    if (!previous) return;
    this.preflightInventory(['sale', previous, -1]);
    // The linked intake document leaves with the voucher; a settled claim stays.
    const receipt = previous?.warrantyReceiptId != null
      ? this.warrantyReceipts().find(r => r.id === previous.warrantyReceiptId)
      : previous ? this.warrantyReceipts().find(r => r.saleId === id) : undefined;
    if (receipt && !receipt.replacementClaimNo) {
      const result = this.deleteWarrantyReceipt(receipt.id);
      if (!result.ok) throw new Error(result.error || 'Warranty removal rejected.');
    }
    if (previous.batteryVoucherId != null) this.deleteBatteryVoucher(previous.batteryVoucherId);
    if (previous) this.archive('sm_sales_v1', 'বিক্রয়', previous);
    this.sales.update(list => list.filter(s => s.id !== id));
    this.saveSales();
    if (previous) this.postSale(previous, -1);
  }

  readonly defaultVoucherSettings: VoucherSettings = {
    businessNamePart1: 'এস এম',
    businessNamePart2: 'এন্টারপ্রাইজ',
    businessColor1: '#dc2626',
    businessColor2: '#087d6c',
    address: 'ফুলবাড়ীগেট, খুলনা',
    mobile: '01975-232346, 01724-955851',
    email: 'smenterprise@gmail.com',
    vatRegNo: '',
    tradeLicenseNo: '',
    soldBy: 'Admin',
    showLogo: true,
    showWatermark: false,
    watermarkText: 'SM ENTERPRISE',
    watermarkOpacity: 0.04,
    watermarkRotation: -30,
    showQRCode: true,
    showPosQrCode: true,
    qrMode: 'link',
    qrSize: 75,
    showOldBatteries: true,
    showReturnedGoods: true,
    showNotes: true,
    showGreeting: true,
    showTerms: true,
    showSummary: true,
    showSignatureImage: true,
    showPaymentStatus: true,
    showItemCode: true,
    showCopyLabels: true,
    showAmountInWords: true,
    accentColor: '#087d6c',
    greetingText: 'ধন্যবাদ, আবার আসবেন!',
    notesText: '',
    warrantyNote: 'ওয়ারেন্টি সংক্রান্ত যেকোনো তথ্যের জন্য ক্লেইম নম্বর ও মূল ইনভয়েস সংরক্ষণ করুন।',
    term1: '১. পণ্য বিক্রির পর ফেরত বা পরিবর্তন হবে না।',
    term2: '২. ইলেকট্রনিক্স পণ্যের কোন গ্যারান্টি নাই; ফেরত ও পরিবর্তন কর্তৃপক্ষের অনুমোদন সাপেক্ষে।',
    purchaseGreeting: 'ধন্যবাদ, সহযোগিতার জন্য কৃতজ্ঞ।',
    purchaseTerm1: '১. ক্রয়কৃত পণ্যের ওয়ারেন্টি/গ্যারান্টি সরবরাহকারীর শর্ত অনুযায়ী প্রযোজ্য।',
    purchaseTerm2: '২. পণ্য ফেরত নিতে হলে পূর্বে কর্তৃপক্ষের অনুমোদন প্রয়োজন।',
    allowWholesalePrice: false,
    creditGreeting: 'আপনার আস্থার জন্য ধন্যবাদ!',
    creditTerm1: '১. ফেরত নেওয়া পণ্যের মূল্য গ্রাহকের হিসাবে ক্রেডিট হিসাব হয়েছে।',
    creditTerm2: '২. পণ্যের অবস্থা যাচাই শেষ হলে ক্রেডিট চূড়ান্ত বলে গণ্য হবে।',
    debitGreeting: 'সহযোগিতার জন্য ধন্যবাদ!',
    debitTerm1: '১. ফেরত দেওয়া পণ্যের মূল্য পরবর্তী বিলে সমন্বয় হবে।',
    debitTerm2: '২. সরবরাহকারীর অনুমোদন ছাড়া পণ্য ফেরত প্রযোজ্য হবে না।',
    termsFontSize: 10,
    signatureTitle: 'অনুমোদিত স্বাক্ষর',
    signatureImage: '',
    paperSize: 'A4',
    printOrientation: 'portrait',
    copiesPerPage: 1,
    customPaperWidthMm: 210,
    customPaperHeightMm: 297,
    pageMarginMm: 9,
    fontFamily: 'Kalpurush'
  };

  private readonly voucherSettingsKey = 'sm_voucher_settings_v2';

  readonly voucherSettings = signal<VoucherSettings>({ ...this.defaultVoucherSettings });

  /** Fills settings saved before a field existed so new switches keep their default. */
  normalizeVoucherSettings(saved: VoucherSettings): VoucherSettings {
    const merged = { ...this.defaultVoucherSettings, ...saved };
    // 90 was the previous default QR size; saved records carrying it were never touched by the user.
    if (merged.qrSize === 90) merged.qrSize = 75;
    if (merged.qrMode !== 'text') merged.qrMode = 'link';
    const margin = Number(merged.pageMarginMm);
    merged.pageMarginMm = Number.isFinite(margin) ? Math.min(30, Math.max(0, margin)) : 9;
    return merged;
  }

  updateVoucherSettings(newSettings: Partial<VoucherSettings>) {
    this.voucherSettings.update(curr => ({ ...curr, ...newSettings }));
  }

  resetVoucherSettings() {
    this.voucherSettings.set({ ...this.defaultVoucherSettings });
  }

  // ------------------------------------------------------------------
  // Warranty module settings: everything the shop can retune (numbering,
  // vocabulary, rules, print text) lives here instead of the page code.
  // ------------------------------------------------------------------
  private readonly defaultWarrantySettings: WarrantySettings = {
    receiptPrefix: 'WR',
    replacementPrefix: 'WX',
    startNumber: 1001,
    defaultWarrantyDays: 0,
    receiptStatuses: ['গ্রহণ করা হয়েছে', 'সরবরাহকারীর কাছে পাঠানো হয়েছে', 'মেরামত চলছে', 'মেরামত সম্পন্ন', 'পরিবর্তন সম্পন্ন', 'মূল গ্রাহকের কাছে ফেরত', 'বাতিল'],
    receiptReplacedStatus: 'পরিবর্তন সম্পন্ন',
    replacementStatuses: ['সম্পন্ন', 'অপেক্ষমাণ', 'বাতিল'],
    conditions: ['খারাপ (ডেড)', 'আংশিক কাজ করে', 'ফুলে গেছে', 'লিক হয়েছে', 'ফিজিক্যাল ড্যামেজ', 'অন্য সমস্যা'],
    dispositions: ['সরবরাহকারীর কাছে ফেরত', 'স্ক্র্যাপ/ডিসপোজাল', 'মেরামত করে স্টকে', 'গ্রাহককে ফেরত'],
    requireInvoice: false,
    requireSerial: false,
    allowMainStockReplacement: true,
    allowNegativeStock: false,
    autoSettleReceipt: true,
    printTitle: 'ওয়ারেন্টি ক্লেইম রিসিট',
    printFooter: 'এই রিসিট ওয়ারেন্টি ক্লেইমের প্রমাণ হিসেবে সংরক্ষণ করুন।',
    printTerms: 'ওয়ারেন্টি শুধু প্রস্তুতকারকের শর্ত অনুযায়ী প্রযোজ্য। ফিজিক্যাল ড্যামেজ বা পানিতে ক্ষতিগ্রস্ত পণ্য ওয়ারেন্টির আওতাভুক্ত নয়।'
  };

  private readonly warrantySettingsRecords = signal<(WarrantySettings & { id: number })[]>([]);

  readonly warrantySettings = computed<WarrantySettings>(() => ({
    ...this.defaultWarrantySettings,
    ...this.warrantySettingsRecords()[0]
  }));

  updateWarrantySettings(newSettings: Partial<WarrantySettings>) {
    this.warrantySettingsRecords.set([{ ...this.warrantySettings(), ...newSettings, id: 1 }]);
  }

  resetWarrantySettings() {
    this.warrantySettingsRecords.set([{ ...this.defaultWarrantySettings, id: 1 }]);
  }
}
