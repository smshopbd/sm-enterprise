import { Injectable, inject, signal } from '@angular/core';
import { CloudService } from './cloud';

interface PageScope {
  /** Longest matching route prefix wins. */
  prefix: string;
  label: { bn: string; en: string };
  keys: string[];
}

/** A dead network must not hold the page's pull open. */
const MAX_WAIT_MS = 12_000;
/** Re-entering the same page within this window reuses what was just pulled. */
const REVISIT_MS = 60_000;

/** Products carry the unit list too: every product screen names its units. */
const TAXONOMY = [
  'sm_categories_v2', 'sm_sub_categories_v2', 'sm_brands_v2',
  'sm_product_models_v2', 'sm_variations_v2', 'sm_units_v1', 'sm_warehouses_v1'
];
const PRODUCTS = ['sm_products_v2', ...TAXONOMY];
const PARTIES = ['sm_parties_v1', 'sm_wallet_accounts_v1'];
const WARRANTY = [
  'sm_warranties_v1', 'sm_warranty_receipts_v1', 'sm_warranty_replacements_v1',
  'sm_warranty_stock_v1', 'sm_warranty_settings_v1'
];
const ACCOUNTING = [
  'sm_sales_v1', 'sm_sales_returns_v1', 'sm_purchases_v1', 'sm_payments_v1',
  'sm_expenses_v1', 'sm_salary_payments_v1', 'sm_rent_payments_v1',
  'sm_staff_advances_v1', 'sm_wallet_txns_v1', 'sm_cash_closings_v1',
  ...PARTIES
];
const OPERATIONS = [
  'sm_battery_vouchers_v1', 'sm_supplier_returns_v1', 'sm_online_requests_v1',
  'sm_damage_records_v1', 'sm_installments_v1', 'sm_quotations_v1',
  'sm_observations_v1', 'sm_hrm_staff_v1', 'sm_attendance_v1', 'sm_hrm_leaves_v1', 'sm_stock_adjustments_v1'
];
/** Pages that genuinely aggregate the whole shop. */
const SHOP = [...ACCOUNTING, ...PRODUCTS, ...WARRANTY, ...OPERATIONS];

/**
 * Each route declares the collections it actually renders. The loader pulls
 * only these, so opening the app no longer downloads every table before the
 * first page appears.
 */
const SCOPES: PageScope[] = [
  {
    prefix: '/dashboard',
    label: { bn: 'ড্যাশবোর্ড', en: 'Dashboard' },
    keys: SHOP
  },
  { prefix: '/parties', label: { bn: 'পার্টি', en: 'Parties' }, keys: [...PARTIES, 'sm_sales_v1', 'sm_purchases_v1', 'sm_payments_v1', 'sm_sales_returns_v1', ...WARRANTY] },
  { prefix: '/product-manager/products', label: { bn: 'পণ্য', en: 'Products' }, keys: [...PRODUCTS, 'sm_stock_adjustments_v1', 'sm_warranties_v1'] },
  { prefix: '/product-manager/brands', label: { bn: 'ব্র্যান্ড', en: 'Brands' }, keys: PRODUCTS },
  { prefix: '/product-manager/models', label: { bn: 'মডেল', en: 'Models' }, keys: PRODUCTS },
  { prefix: '/product-manager/categories', label: { bn: 'ক্যাটাগরি', en: 'Categories' }, keys: PRODUCTS },
  { prefix: '/product-manager/sub-categories', label: { bn: 'সাব-ক্যাটাগরি', en: 'Sub-categories' }, keys: PRODUCTS },
  { prefix: '/product-manager/variations', label: { bn: 'ভ্যারিয়েশন', en: 'Variations' }, keys: PRODUCTS },
  {
    prefix: '/product-manager/warranty',
    label: { bn: 'ওয়ারেন্টি পণ্য', en: 'Warranty products' },
    keys: [...WARRANTY, ...PRODUCTS, 'sm_parties_v1']
  },
  { prefix: '/product-manager/print-barcode', label: { bn: 'বারকোড প্রিন্ট', en: 'Print barcode' }, keys: PRODUCTS },
  {
    prefix: '/warranty',
    label: { bn: 'ওয়ারেন্টি', en: 'Warranty' },
    keys: [...WARRANTY, ...PRODUCTS, 'sm_sales_v1', ...PARTIES]
  },
  {
    prefix: '/sales',
    label: { bn: 'বিক্রয়', en: 'Sales' },
    keys: [
      'sm_sales_v1', 'sm_sales_returns_v1', 'sm_payments_v1', ...PARTIES,
      ...PRODUCTS, ...WARRANTY, 'sm_installments_v1', 'sm_quotations_v1', 'sm_hrm_staff_v1'
    ]
  },
  {
    prefix: '/purchases',
    label: { bn: 'ক্রয়', en: 'Purchases' },
    keys: [
      'sm_purchases_v1', 'sm_supplier_returns_v1', 'sm_payments_v1', 'sm_online_requests_v1',
      ...PARTIES, ...PRODUCTS
    ]
  },
  { prefix: '/battery', label: { bn: 'ব্যাটারি', en: 'Battery' }, keys: ['sm_battery_vouchers_v1', ...PARTIES] },
  {
    prefix: '/pos',
    label: { bn: 'পিওএস', en: 'POS' },
    keys: [
      'sm_sales_v1', 'sm_installments_v1', 'sm_quotations_v1',
      ...PRODUCTS, ...PARTIES, 'sm_warranties_v1'
    ]
  },
  { prefix: '/stock', label: { bn: 'স্টক', en: 'Stock' }, keys: [...PRODUCTS, 'sm_stock_adjustments_v1'] },
  {
    prefix: '/wallet',
    label: { bn: 'ওয়ালেট', en: 'Wallet' },
    keys: [
      ...ACCOUNTING, 'sm_hrm_staff_v1', 'sm_sales_v1', 'sm_purchases_v1'
    ]
  },
  { prefix: '/hrm/staff', label: { bn: 'স্টাফ', en: 'Staff' }, keys: ['sm_hrm_staff_v1', 'sm_attendance_v1', 'sm_hrm_leaves_v1', 'sm_salary_payments_v1', 'sm_staff_advances_v1'] },
  { prefix: '/hrm/attendance', label: { bn: 'হাজিরা', en: 'Attendance' }, keys: ['sm_attendance_v1', 'sm_hrm_staff_v1', 'sm_hrm_leaves_v1'] },
  { prefix: '/hrm/leave', label: { bn: 'ছুটি', en: 'Leave' }, keys: ['sm_hrm_leaves_v1', 'sm_hrm_staff_v1', 'sm_attendance_v1'] },
  { prefix: '/hrm/staff-advance', label: { bn: 'স্টাফ অগ্রিম', en: 'Staff advance' }, keys: ['sm_staff_advances_v1', 'sm_hrm_staff_v1', 'sm_wallet_accounts_v1', 'sm_wallet_txns_v1'] },
  { prefix: '/hrm/salary', label: { bn: 'বেতন', en: 'Salary' }, keys: ['sm_salary_payments_v1', 'sm_hrm_staff_v1', 'sm_hrm_leaves_v1', 'sm_attendance_v1', 'sm_wallet_accounts_v1'] },
  { prefix: '/hrm/rent', label: { bn: 'দোকান ভাড়া', en: 'Shop rent' }, keys: ['sm_rent_payments_v1', 'sm_wallet_accounts_v1'] },
  { prefix: '/hrm/expenses', label: { bn: 'খরচ', en: 'Expenses' }, keys: ['sm_expenses_v1', 'sm_wallet_accounts_v1'] },
  {
    prefix: '/damage',
    label: { bn: 'ড্যামেজ', en: 'Damage' },
    keys: ['sm_damage_records_v1', ...PRODUCTS]
  },
  { prefix: '/accounts', label: { bn: 'পার্টি হিসাব', en: 'Accounts' }, keys: [...ACCOUNTING, ...PRODUCTS] },
  {
    prefix: '/cash-bank',
    label: { bn: 'ক্যাশ ও ব্যাংক', en: 'Cash & bank' },
    keys: [
      ...ACCOUNTING, 'sm_battery_vouchers_v1', 'sm_hrm_staff_v1'
    ]
  },
  {
    prefix: '/reports',
    label: { bn: 'রিপোর্ট', en: 'Reports' },
    keys: SHOP
  },
  { prefix: '/recycle-bin', label: { bn: 'রিসাইকেল বিন', en: 'Recycle bin' }, keys: ['sm_recycle_v1'] },
  {
    prefix: '/settings',
    label: { bn: 'সেটিংস', en: 'Settings' },
    // Settings edits, backs up and repairs the whole shop, so it loads the shop.
    keys: [...SHOP, 'sm_users_v1', 'sm_audit_v1', 'sm_voucher_settings_v2', 'sm_recycle_v1']
  },
  { prefix: '/app-info', label: { bn: 'অ্যাপ তথ্য', en: 'App info' }, keys: [] }
];

const EMPTY: PageScope = { prefix: '', label: { bn: '', en: '' }, keys: [] };

/**
 * Page-based data loading. A route entry names the collections that page needs;
 * only those are pulled from Supabase and reported by the loader. Reads stay
 * local-first, so pages paint from IndexedDB and refresh when the pull lands.
 */
@Injectable({ providedIn: 'root' })
export class PageDataService {
  private readonly cloud = inject(CloudService);

  private readonly active = signal<PageScope>(EMPTY);
  private activePath = '';
  private request = 0;
  private readonly loadedAt = new Map<string, number>();
  private pulling = 0;

  /** True while the open page's collections are being refreshed from the cloud. */
  readonly loading = signal(false);

  keysFor(url: string): string[] {
    return this.resolve(this.pathOf(url)).keys;
  }

  enter(url: string, force = false): void {
    const path = this.pathOf(url);
    const scope = this.resolve(path);
    if (!force && path === this.activePath) return;
    this.activePath = path;
    this.active.set(scope);
    this.cloud.setActiveScope(scope.keys);

    if (!scope.keys.length || typeof window === 'undefined') return;
    if (!this.cloud.isEnabled() || !this.cloud.config().autoSync) return;
    const last = this.loadedAt.get(path);
    if (!force && last && Date.now() - last < REVISIT_MS) return;
    void this.load(path, scope);
  }

  /** The splash already pulled this page's rows; the first navigation must not repeat it. */
  markLoaded(url: string): void {
    const path = this.pathOf(url);
    this.activePath = path;
    this.loadedAt.set(path, Date.now());
    this.active.set(this.resolve(path));
    this.cloud.setActiveScope(this.resolve(path).keys);
  }

  private async load(path: string, scope: PageScope): Promise<void> {
    const id = ++this.request;
    this.pulling++;
    this.loading.set(true);
    try {
      await Promise.race([
        // claim: this entry supersedes any page still queued behind it.
        this.cloud.syncPage(scope.keys, true).catch(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, MAX_WAIT_MS))
      ]);
      // A newer page already owns the bookkeeping; leave it alone.
      if (id === this.request) this.loadedAt.set(path, Date.now());
    } finally {
      this.pulling = Math.max(0, this.pulling - 1);
      if (!this.pulling) this.loading.set(false);
    }
  }

  private pathOf(url: string): string {
    return (url.split('?')[0].split('#')[0] || '/').replace(/\/+$/, '') || '/';
  }

  private resolve(path: string): PageScope {
    let best: PageScope | undefined;
    for (const scope of SCOPES) {
      if (path === scope.prefix || path.startsWith(`${scope.prefix}/`)) {
        if (!best || scope.prefix.length > best.prefix.length) best = scope;
      }
    }
    return best ?? EMPTY;
  }
}
