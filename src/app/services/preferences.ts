import { Injectable, signal } from '@angular/core';

export type AppLanguage = 'bn' | 'en';

export type AccentKey = 'teal' | 'blue' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose';

/** Light/dark explicitly, or follow the device setting. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** Row hover tint strength; the hue always comes from the active accent. */
export type TableHoverTone = 'soft' | 'medium' | 'deep';

/** Row/cell border look for every data table. */
export type TableBorderMode = 'soft' | 'grid' | 'bold' | 'none';

export const TABLE_HOVER_TONES: { key: TableHoverTone; bn: string; en: string }[] = [
  { key: 'soft', bn: 'হালকা', en: 'Soft' },
  { key: 'medium', bn: 'মাঝারি', en: 'Medium' },
  { key: 'deep', bn: 'গাঢ়', en: 'Deep' }
];

export const TABLE_BORDER_MODES: { key: TableBorderMode; bn: string; en: string; hintBn: string; hintEn: string }[] = [
  { key: 'soft', bn: 'সফট', en: 'Soft', hintBn: 'শুধু সারির নিচের লাইন', hintEn: 'Row dividers only' },
  { key: 'grid', bn: 'গ্রিড', en: 'Grid', hintBn: 'প্রতিটি ঘরে হালকা বর্ডার', hintEn: 'Light border on every cell' },
  { key: 'bold', bn: 'মোটা', en: 'Bold', hintBn: 'গাঢ় ও মোটা বর্ডার', hintEn: 'Thick, high-contrast borders' },
  { key: 'none', bn: 'বন্ধ', en: 'None', hintBn: 'কোনো বর্ডার নেই', hintEn: 'No borders' }
];

/** Every preset re-colours the Tailwind teal scale, which the whole UI already uses. */
export const ACCENT_PRESETS: { key: AccentKey; bn: string; en: string; shades: Record<string, string> }[] = [
  {
    key: 'teal', bn: 'টিল (ডিফল্ট)', en: 'Teal (default)',
    shades: {
      50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf',
      500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a', 950: '#042f2e'
    }
  },
  {
    key: 'blue', bn: 'নীল', en: 'Blue',
    shades: {
      50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa',
      500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a', 950: '#172554'
    }
  },
  {
    key: 'indigo', bn: 'ইন্ডিগো', en: 'Indigo',
    shades: {
      50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8',
      500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b'
    }
  },
  {
    key: 'violet', bn: 'ভায়োলেট', en: 'Violet',
    shades: {
      50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa',
      500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065'
    }
  },
  {
    key: 'emerald', bn: 'সবুজ', en: 'Emerald',
    shades: {
      50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
      500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22'
    }
  },
  {
    key: 'amber', bn: 'অ্যাম্বার', en: 'Amber',
    // 600+ mirror amber-700+ so white button text keeps WCAG AA contrast.
    shades: {
      50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24',
      500: '#f59e0b', 600: '#b45309', 700: '#92400e', 800: '#78350f', 900: '#5a2a08', 950: '#451a03'
    }
  },
  {
    key: 'rose', bn: 'রোজ', en: 'Rose',
    shades: {
      50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185',
      500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337', 950: '#4c0519'
    }
  }
];

const ACCENT_KEY = 'sm_accent_v1';
const ACCENT_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const TABLE_HOVER_KEY = 'sm_table_hover_v1';
const TABLE_BORDER_KEY = 'sm_table_border_v1';
/* How much accent colour is mixed into the row background. */
const HOVER_MIX: Record<TableHoverTone, number> = { soft: 0.1, medium: 0.2, deep: 0.32 };
const HOVER_MIX_DARK: Record<TableHoverTone, number> = { soft: 0.16, medium: 0.26, deep: 0.4 };

/** Blends two #rrggbb colours; used for accent-derived table tints. */
function mixHex(base: string, over: string, weight: number): string {
  const channels = (hex: string) => {
    const value = hex.replace('#', '');
    return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
  };
  const from = channels(base);
  const to = channels(over);
  return `#${from
    .map((value, index) => Math.round(value + (to[index] - value) * weight).toString(16).padStart(2, '0'))
    .join('')}`;
}

const DICT: Record<string, { bn: string; en: string }> = {
  'app.name': { bn: 'এস এম এন্টারপ্রাইজ', en: 'SM Enterprise' },
  'app.tagline': { bn: 'ইনভেন্টরি, বিক্রয় ও হিসাব', en: 'Inventory, Sales & Accounts' },

  'nav.dashboard': { bn: 'ড্যাশবোর্ড', en: 'Dashboard' },
  'nav.wallet': { bn: 'ওয়ালেট', en: 'Wallet' },
  'nav.parties': { bn: 'পার্টি', en: 'Parties' },
  'nav.partiesAll': { bn: 'সকল পার্টি', en: 'All Parties' },
  'nav.staff': { bn: 'স্টাফ', en: 'Staff Members' },
  'nav.customers': { bn: 'কাস্টমার', en: 'Customers' },
  'nav.corporate': { bn: 'কর্পোরেট কাস্টমার', en: 'Corporate Customers' },
  'nav.suppliers': { bn: 'সাপ্লায়ার', en: 'Suppliers' },
  'nav.dealers': { bn: 'ডিলার', en: 'Dealers' },
  'nav.hrm': { bn: 'এইচআরএম', en: 'HRM' },
  'nav.employees': { bn: 'কর্মীর তথ্য', en: 'Employee Info' },
  'nav.attendance': { bn: 'হাজিরা', en: 'Attendance' },
  'nav.leave': { bn: 'ছুটি', en: 'Leave' },
  'nav.payroll': { bn: 'বেতন', en: 'Salary' },
  'nav.shopRent': { bn: 'দোকানের ভাড়া', en: 'Shop Rent' },
  'nav.dailyExpense': { bn: 'দৈনিক খরচ', en: 'Daily Expense' },
  'nav.productManager': { bn: 'প্রোডাক্ট ম্যানেজার', en: 'Product Manager' },
  'nav.brands': { bn: 'ব্র্যান্ড', en: 'Brands' },
  'nav.models': { bn: 'প্রোডাক্ট মডেল', en: 'Product Models' },
  'nav.categories': { bn: 'ক্যাটাগরি', en: 'Categories' },
  'nav.subCategories': { bn: 'সাব ক্যাটাগরি', en: 'Sub Categories' },
  'nav.variations': { bn: 'ভ্যারিয়েশন', en: 'Variations' },
  'nav.products': { bn: 'পণ্য', en: 'Products' },
  'nav.warranty': { bn: 'প্রোডাক্ট ওয়ারেন্টি', en: 'Product Warranty' },
  'nav.warrantySystem': { bn: 'ওয়ারেন্টি ব্যবস্থাপনা', en: 'Warranty Management' },
  'nav.warrantyReceive': { bn: 'ওয়ারেন্টি গ্রহণ', en: 'Warranty Receiving' },
  'nav.warrantyReplace': { bn: 'ওয়ারেন্টি পরিবর্তন', en: 'Warranty Replacement' },
  'nav.warrantyStock': { bn: 'গ্রহণ স্টক — বর্তমান ব্যালেন্স', en: 'Intake Stock — Current Balances' },
  'nav.warrantyStockLedger': { bn: 'গ্রহণ স্টক — লেনদেনের ইতিহাস', en: 'Intake Stock — Movement History' },
  'nav.warrantySettings': { bn: 'ওয়ারেন্টি কাস্টমাইজ', en: 'Customize Warranty' },
  'nav.printBarcode': { bn: 'বারকোড প্রিন্ট', en: 'Print Barcode' },
  'nav.sales': { bn: 'বিক্রয়', en: 'Sales' },
  'nav.salesList': { bn: 'বিক্রয় তালিকা', en: 'Sales' },
  'nav.addSale': { bn: 'নতুন বিক্রয়', en: 'Add Sale' },
  'nav.staffAdvance': { bn: 'স্টাফ অ্যাডভান্স', en: 'Staff Advance' },
  'nav.salesReturn': { bn: 'বিক্রয় ফেরত / ক্রেডিট নোট', en: 'Sales Return / Cr. Note' },
  'nav.paymentIn': { bn: 'পেমেন্ট ইন', en: 'Payment In' },
  'nav.purchases': { bn: 'ক্রয়', en: 'Purchases' },
  'nav.purchasesList': { bn: 'ক্রয় তালিকা', en: 'Purchases' },
  'nav.addPurchase': { bn: 'নতুন ক্রয়', en: 'New Purchase' },
  'nav.purchaseReturn': { bn: 'ক্রয় ফেরত / ডেবিট নোট', en: 'Purchase Return / Dr. Note' },
  'nav.onlineRequests': { bn: 'অনলাইন রিকোয়েস্ট', en: 'Online Requests' },
  'nav.paymentOut': { bn: 'পেমেন্ট আউট', en: 'Payment Out' },
  'nav.damage': { bn: 'ড্যামেজ', en: 'Damage' },
  'nav.damageRecords': { bn: 'ড্যামেজ রেকর্ড', en: 'Damage Records' },
  'nav.battery': { bn: 'পুরাতন ব্যাটারি ম্যানেজমেন্ট', en: 'Old Battery Management' },
  'nav.batteryPurchase': { bn: 'পুরোনো ব্যাটারি ক্রয়', en: 'Old Battery Purchase' },
  'nav.batterySale': { bn: 'পুরোনো ব্যাটারি কেজিতে/পিস বিক্রি', en: 'Old Battery Sale (kg/pcs)' },
  'nav.batteryExchange': { bn: 'ভালো পুরোনো ব্যাটারি বদল', en: 'Old Battery Exchange' },
  'nav.batteryPurchaseVouchers': { bn: 'ভাউচার ব্যাটারি ক্রয়', en: 'Battery Purchase Vouchers' },
  'nav.batterySaleVouchers': { bn: 'ভাউচার ব্যাটারি বিক্রয়', en: 'Battery Sale Vouchers' },
  'nav.batteryExchangeVouchers': { bn: 'ব্যাটারি বদল ভাউচার', en: 'Battery Exchange Vouchers' },
  'nav.batteryLedger': { bn: 'লেজার স্টোক', en: 'Stock Ledger' },
  'nav.stock': { bn: 'স্টক', en: 'Stock' },
  'nav.stockReport': { bn: 'স্টক রিপোর্ট', en: 'Stock Report' },
  'nav.stockTransfer': { bn: 'স্টক ট্রান্সফার', en: 'Stock Transfer' },
  'nav.pos': { bn: 'পিওএস', en: 'POS' },
  'nav.accounts': { bn: 'হিসাব', en: 'Accounts' },
  'nav.accountsSummary': { bn: 'হিসাব সারসংক্ষেপ', en: 'Accounts Summary' },
  'nav.balanceSheet': { bn: 'ব্যালান্স শিট', en: 'Balance Sheet' },
  'nav.cashBank': { bn: 'ক্যাশ ও ব্যাংক', en: 'Cash & Bank' },
  'nav.dayBook': { bn: 'দিনের লেনদেনের বই', en: 'Day Book' },
  'nav.closingHistory': { bn: 'ক্লোজিং হিস্ট্রি', en: 'Closing History' },
  'nav.reports': { bn: 'রিপোর্ট', en: 'Reports' },
  'nav.salesReport': { bn: 'বিক্রয় রিপোর্ট', en: 'Sales Report' },
  'nav.purchaseReport': { bn: 'ক্রয় রিপোর্ট', en: 'Purchase Report' },
  'nav.profitReport': { bn: 'লাভ / ক্ষতি রিপোর্ট', en: 'Profit / Loss Report' },
  'nav.recycleBin': { bn: 'রিসাইকেল বিন', en: 'Recycle Bin' },
  'nav.settings': { bn: 'সেটিংস', en: 'Settings' },
  'nav.appInfo': { bn: 'এ্যাপ সম্পর্কিত তথ্য', en: 'App Guide & Info' },
  'nav.logout': { bn: 'লগআউট', en: 'Logout' },
  'nav.searchMenu': { bn: 'মেনু খুঁজুন...', en: 'Search menu...' },

  'header.search': { bn: 'খুঁজুন', en: 'Search' },
  'header.profile': { bn: 'প্রোফাইল', en: 'Profile' },
  'header.switchUser': { bn: 'ইউজার বদলান', en: 'Switch user' },
  'header.lowStock': { bn: 'স্টক অ্যালার্ট', en: 'Stock alerts' },
  'header.calculator': { bn: 'ক্যালকুলেটর', en: 'Calculator' },
  'header.summary': { bn: 'সারসংক্ষেপ', en: 'Summary' },
  'header.purchase': { bn: 'ক্রয়', en: 'Purchase' },
  'header.expense': { bn: 'খরচ', en: 'Expense' },
  'header.viewAll': { bn: 'সব দেখুন', en: 'View all' },
  'header.noLowStock': { bn: 'কোনো স্টক অ্যালার্ট নেই', en: 'No stock alerts' },

  'common.save': { bn: 'সংরক্ষণ', en: 'Save' },
  'common.cancel': { bn: 'বাতিল', en: 'Cancel' },
  'common.close': { bn: 'বন্ধ', en: 'Close' },
  'common.add': { bn: 'যোগ করুন', en: 'Add' },
  'common.edit': { bn: 'এডিট', en: 'Edit' },
  'common.delete': { bn: 'ডিলিট', en: 'Delete' },
  'common.search': { bn: 'খুঁজুন', en: 'Search' },
  'common.print': { bn: 'প্রিন্ট', en: 'Print' },
  'common.excel': { bn: 'এক্সেল', en: 'Excel' },
  'common.total': { bn: 'মোট', en: 'Total' },
  'common.paid': { bn: 'পরিশোধিত', en: 'Paid' },
  'common.opening': { bn: 'প্রারম্ভিক', en: 'Opening' },
  'common.due': { bn: 'বাকি', en: 'Due' },
  'common.amount': { bn: 'পরিমাণ', en: 'Amount' },
  'common.date': { bn: 'তারিখ', en: 'Date' },
  'common.note': { bn: 'নোট', en: 'Note' },
  'common.type': { bn: 'ধরন', en: 'Type' },
  'common.status': { bn: 'স্ট্যাটাস', en: 'Status' },
  'common.actions': { bn: 'অ্যাকশন', en: 'Actions' },
  'common.customer': { bn: 'কাস্টমার', en: 'Customer' },
  'common.supplier': { bn: 'সাপ্লায়ার', en: 'Supplier' },
  'common.balance': { bn: 'ব্যালান্স', en: 'Balance' },
  'common.receipt': { bn: 'রসিদ', en: 'Receipt' },
  'common.today': { bn: 'আজ', en: 'Today' },
  'common.all': { bn: 'সকল', en: 'All' },
  'common.name': { bn: 'নাম', en: 'Name' },
  'common.phone': { bn: 'মোবাইল', en: 'Phone' },
  'common.mode': { bn: 'পেমেন্ট মাধ্যম', en: 'Payment Mode' },
  'common.cash': { bn: 'ক্যাশ', en: 'Cash' },
  'common.bank': { bn: 'ব্যাংক', en: 'Bank' },
  'common.discount': { bn: 'ডিসকাউন্ট', en: 'Discount' },
  'common.noData': { bn: 'কোনো তথ্য নেই', en: 'No data found' },

  'login.title': { bn: 'লগইন করুন', en: 'Sign in' },
  'login.subtitle': { bn: 'আপনার অ্যাকাউন্টে প্রবেশ করুন', en: 'Access your account' },
  'login.username': { bn: 'ইউজারনেম', en: 'Username' },
  'login.pin': { bn: 'পাসওয়ার্ড', en: 'Password' },
  'login.button': { bn: 'প্রবেশ করুন', en: 'Sign in' },
  'login.error': { bn: 'ইউজারনেম বা পিন সঠিক নয়।', en: 'Invalid username or PIN.' },
  'login.inactive': { bn: 'এই অ্যাকাউন্টটি নিষ্ক্রিয়।', en: 'This account is disabled.' },

  'ledger.title': { bn: 'পার্টি লেজার', en: 'Party Ledger' },
  'ledger.transactions': { bn: 'লেনদেন', en: 'Transactions' },
  'ledger.sales': { bn: 'বিক্রয়', en: 'Sales' },
  'ledger.purchases': { bn: 'ক্রয়', en: 'Purchases' },
  'ledger.payments': { bn: 'পেমেন্ট', en: 'Payments' },
  'ledger.returns': { bn: 'ফেরত', en: 'Returns' },
  'ledger.recordPayment': { bn: 'পেমেন্ট নিন / দিন', en: 'Record Payment' },
  'ledger.supplierReturn': { bn: 'সাপ্লায়ার রিটার্ন', en: 'Supplier Return' },
  'ledger.printReceipt': { bn: 'রসিদ প্রিন্ট', en: 'Print Receipt' },
  'ledger.dueAmount': { bn: 'বর্তমান বাকি', en: 'Current Due' },
  'ledger.paymentSaved': { bn: 'পেমেন্ট সফলভাবে সংরক্ষিত হয়েছে', en: 'Payment saved successfully' },
  'ledger.returnSaved': { bn: 'রিটার্ন সফলভাবে সংরক্ষিত হয়েছে', en: 'Return saved successfully' },
  'ledger.invalidAmount': { bn: 'সঠিক পরিমাণ লিখুন', en: 'Enter a valid amount' },
  'ledger.invoice': { bn: 'ভাউচার', en: 'Invoice' },
  'ledger.debit': { bn: 'ডেবিট', en: 'Debit' },
  'ledger.credit': { bn: 'ক্রেডিট', en: 'Credit' },
  'ledger.receiptNo': { bn: 'রসিদ নং', en: 'Receipt No' },
  'ledger.receivedWithThanks': { bn: 'ধন্যবাদসহ গ্রহণ করা হলো', en: 'Received with thanks' },
  'ledger.authorizedBy': { bn: 'আধিকারিক স্বাক্ষর', en: 'Authorized Signature' },
  'ledger.opening': { bn: 'প্রারম্ভিক ব্যালান্স', en: 'Opening Balance' },

  'accounts.title': { bn: 'হিসাব সারসংক্ষেপ', en: 'Accounts Summary' },
  'accounts.receivable': { bn: 'কাস্টমার পাওনা', en: 'Customer Receivable' },
  'accounts.payable': { bn: 'সাপ্লায়ার পাওনা', en: 'Supplier Payable' },
  'accounts.collected': { bn: 'আজ আদায়', en: 'Collected Today' },
  'accounts.payments': { bn: 'পেমেন্ট হিস্ট্রি', en: 'Payment History' },
  'accounts.customerLedger': { bn: 'কাস্টমার লেজার', en: 'Customer Ledger' },
  'accounts.supplierLedger': { bn: 'সাপ্লায়ার লেজার', en: 'Supplier Ledger' },
  'accounts.viewLedger': { bn: 'লেজার দেখুন', en: 'View Ledger' },

  'cash.title': { bn: 'ক্যাশ ও ব্যাংক', en: 'Cash & Bank' },
  'cash.closing': { bn: 'দৈনিক ক্যাশ ক্লোজিং', en: 'Daily Cash Closing' },
  'cash.opening': { bn: 'প্রারম্ভিক ক্যাশ', en: 'Opening Cash' },
  'cash.cashSales': { bn: 'ক্যাশ বিক্রয়', en: 'Cash Sales' },
  'cash.bankSales': { bn: 'ব্যাংক পেমেন্ট', en: 'Bank Payments' },
  'cash.collections': { bn: 'বাকি আদায় (ক্যাশ)', en: 'Cash Collections' },
  'cash.expenses': { bn: 'আজকের খরচ', en: 'Expenses' },
  'cash.expected': { bn: 'কাঙ্ক্ষিত ড্রয়ার', en: 'Expected Drawer' },
  'cash.counted': { bn: 'গণনা করা ক্যাশ', en: 'Counted Cash' },
  'cash.difference': { bn: 'পার্থক্য', en: 'Difference' },
  'cash.balanced': { bn: 'মিলে গেছে', en: 'Balanced' },
  'cash.short': { bn: 'কম', en: 'Short' },
  'cash.excess': { bn: 'বেশি', en: 'Excess' },
  'cash.saveClosing': { bn: 'ক্লোজিং সংরক্ষণ', en: 'Save Closing' },
  'cash.history': { bn: 'ক্লোজিং হিস্ট্রি', en: 'Closing History' },
  'cash.closedBy': { bn: 'ক্লোজ করেছেন', en: 'Closed By' },
  'cash.saved': { bn: 'ক্যাশ ক্লোজিং সংরক্ষিত হয়েছে', en: 'Cash closing saved' },

  'reports.title': { bn: 'রিপোর্ট ও বিশ্লেষণ', en: 'Reports & Analytics' },
  'reports.profitLoss': { bn: 'লাভ / ক্ষতি', en: 'Profit / Loss' },
  'reports.productProfit': { bn: 'পণ্যভিত্তিক লাভ', en: 'Product Profit' },
  'reports.categoryProfit': { bn: 'ক্যাটাগরিভিত্তিক লাভ', en: 'Category Profit' },
  'reports.stockValue': { bn: 'স্টক ভ্যালুয়েশন', en: 'Stock Valuation' },
  'reports.sales': { bn: 'মোট বিক্রয়', en: 'Total Sales' },
  'reports.cogs': { bn: 'পণ্যের ক্রয়মূল্য', en: 'Cost of Goods' },
  'reports.gross': { bn: 'গ্রস লাভ', en: 'Gross Profit' },
  'reports.expenses': { bn: 'খরচ', en: 'Expenses' },
  'reports.net': { bn: 'নিট লাভ', en: 'Net Profit' },
  'reports.margin': { bn: 'মার্জিন', en: 'Margin' },
  'reports.qtySold': { bn: 'বিক্রীত পরিমাণ', en: 'Qty Sold' },
  'reports.revenue': { bn: 'বিক্রয়', en: 'Revenue' },
  'reports.cost': { bn: 'ক্রয়মূল্য', en: 'Cost' },
  'reports.profit': { bn: 'লাভ', en: 'Profit' },
  'reports.stockCost': { bn: 'স্টক (ক্রয়মূল্য)', en: 'Stock at Cost' },
  'reports.stockSales': { bn: 'স্টক (বিক্রয়মূল্য)', en: 'Stock at Sale Value' },
  'reports.from': { bn: 'শুরু', en: 'From' },
  'reports.to': { bn: 'শেষ', en: 'To' },
  'reports.print': { bn: 'রিপোর্ট প্রিন্ট', en: 'Print Report' },
  'reports.export': { bn: 'এক্সপোর্ট', en: 'Export' },

  'settings.title': { bn: 'সিস্টেম সেটিংস', en: 'System Settings' },
  'settings.business': { bn: 'ব্যবসার তথ্য', en: 'Business' },
  'settings.users': { bn: 'ইউজার ও রোল', en: 'Users & Roles' },
  'settings.audit': { bn: 'অডিট লগ', en: 'Audit Log' },
  'settings.company': { bn: 'প্রতিষ্ঠানের নাম', en: 'Company Name' },
  'settings.address': { bn: 'ঠিকানা', en: 'Address' },
  'settings.email': { bn: 'ইমেইল', en: 'Email' },
  'settings.saved': { bn: 'সেটিংস সংরক্ষিত হয়েছে', en: 'Settings saved' },
  'settings.addUser': { bn: 'নতুন ইউজার', en: 'Add User' },
  'settings.role': { bn: 'রোল', en: 'Role' },
  'settings.user': { bn: 'ইউজার', en: 'User' },
  'settings.action': { bn: 'কাজ', en: 'Action' },
  'settings.detail': { bn: 'বিবরণ', en: 'Detail' },
  'settings.time': { bn: 'সময়', en: 'Time' },
  'settings.active': { bn: 'সক্রিয়', en: 'Active' },
  'settings.inactive': { bn: 'নিষ্ক্রিয়', en: 'Inactive' },
  'settings.onlyAdmin': { bn: 'শুধুমাত্র অ্যাডমিন ইউজার পরিচালনা করতে পারবেন', en: 'Only Admin can manage users' },
  'settings.soldBy': { bn: 'ইনভয়েসে বিক্রেতা', en: 'Sold By (invoice)' },
  'settings.greeting': { bn: 'ইনভয়েসের শুভেচ্ছা বাক্য', en: 'Invoice greeting' },
  'settings.term1': { bn: 'শর্ত ১', en: 'Term 1' },
  'settings.term2': { bn: 'শর্ত ২', en: 'Term 2' },
  'settings.sales': { bn: 'বিক্রয় সেটিংস', en: 'Sales Settings' },
  'settings.wholesale': { bn: 'যেকোনো কাস্টমারকে পাইকারি মূল্যে বিক্রি', en: 'Allow wholesale price for any customer' },
  'settings.wholesaleHint': {
    bn: 'চালু থাকলে Add Sale-এ যেকোনো কাস্টমারকে পাইকারি মূল্যে বিক্রি করা যাবে। বন্ধ থাকলে শুধু ডিলার পার্টি পাইকারি মূল্য পাবে।',
    en: 'When on, Add Sale can bill any customer at the wholesale price. When off, only Dealer parties get wholesale pricing.'
  },

  'role.admin': { bn: 'অ্যাডমিন', en: 'Admin' },
  'role.salesman': { bn: 'সেলসম্যান', en: 'Salesman' },
  'role.accountant': { bn: 'অ্যাকাউন্ট্যান্ট', en: 'Accountant' },

  'pos.shortcuts': { bn: 'শর্টকাট: F2 সার্চ • F4 কার্ট খালি • F8 পেমেন্ট', en: 'Shortcuts: F2 Search • F4 Clear cart • F8 Pay' },
  'pos.priceLocked': { bn: 'মূল্য পরিবর্তন শুধুমাত্র অ্যাডমিন পারবেন', en: 'Only Admin can change prices' },
  'pos.walkIn': { bn: 'ওয়াক-ইন কাস্টমার', en: 'Walk-in Customer' },
  'pos.searchCustomer': { bn: 'কাস্টমার খুঁজুন (নাম / মোবাইল)', en: 'Search customer (name / phone)' },
  'pos.newCustomer': { bn: 'নতুন কাস্টমার', en: 'New Customer' },
  'pos.noCustomer': { bn: 'কোনো কাস্টমার পাওয়া যায়নি', en: 'No customer found' },
  'pos.previousDue': { bn: 'পূর্বের বাকি', en: 'Previous Due' },
  'pos.noPhone': { bn: 'মোবাইল নেই', en: 'No phone' },
  'pos.items': { bn: 'আইটেম', en: 'items' },
  'pos.subtotal': { bn: 'সাব-টোটাল', en: 'Subtotal' },
  'pos.productCode': { bn: 'কোড', en: 'Code' },
  'pos.category': { bn: 'ক্যাটাগরি', en: 'Category' },
  'pos.subCategory': { bn: 'সাব-ক্যাটাগরি', en: 'Sub-category' },
  'pos.brand': { bn: 'ব্র্যান্ড', en: 'Brand' },
  'pos.model': { bn: 'মডেল', en: 'Model' },
  'pos.stock': { bn: 'স্টক', en: 'Stock' },
  'pos.wholesale': { bn: 'পাইকারি', en: 'Wholesale' },
  'pos.rack': { bn: 'র‍্যাক', en: 'Rack' },
  'pos.variant': { bn: 'ভ্যারিয়েন্ট', en: 'Variant' },
  'pos.tax': { bn: 'ট্যাক্স', en: 'Tax' },
  'pos.products': { bn: 'পণ্য', en: 'Products' },
  'pos.cart': { bn: 'কার্ট', en: 'Cart' },
  'pos.emptyCart': { bn: 'কার্ট খালি — পণ্যে ক্লিক করে যোগ করুন', en: 'Cart is empty — tap a product to add' },
  'pos.customerName': { bn: 'কাস্টমারের নাম', en: 'Customer Name' },
  'pos.phone': { bn: 'মোবাইল নাম্বার', en: 'Phone' },
  'pos.company': { bn: 'কোম্পানি', en: 'Company' },
  'pos.address': { bn: 'ঠিকানা', en: 'Address' },
  'pos.customerType': { bn: 'কাস্টমার ধরন', en: 'Customer Type' },
  'pos.nameRequired': { bn: 'কাস্টমারের নাম লিখুন', en: 'Customer name is required' },
  'pos.duplicateCustomer': { bn: 'এই নামে কাস্টমার ইতিমধ্যে আছে', en: 'A customer with this name already exists' },
  'pos.customerAdded': { bn: 'নতুন কাস্টমার যোগ হয়েছে', en: 'New customer added' },
  'pos.payment': { bn: 'পেমেন্ট', en: 'Payment' },
  'pos.method': { bn: 'পেমেন্ট মাধ্যম', en: 'Payment Method' },
  'pos.cash': { bn: 'ক্যাশ', en: 'Cash' },
  'pos.card': { bn: 'কার্ড', en: 'Card' },
  'pos.cashReceived': { bn: 'নগদ গ্রহণ', en: 'Cash Received' },
  'pos.amountPaid': { bn: 'পরিশোধিত টাকা', en: 'Amount Paid' },
  'pos.change': { bn: 'ফেরত', en: 'Change' },
  'pos.remainingDue': { bn: 'বাকি থাকবে', en: 'Due' },
  'pos.exact': { bn: 'সম্পূর্ণ', en: 'Exact' },
  'pos.totalPayable': { bn: 'মোট প্রদেয়', en: 'Total Payable' },
  'pos.completeSale': { bn: 'বিক্রয় সম্পন্ন করুন', en: 'Complete Sale' },
  'pos.walkInDue': { bn: 'ওয়াক-ইন কাস্টমারের বাকি রাখা যাবে না। কাস্টমার নির্বাচন করুন।', en: 'Walk-in customer cannot have due. Please select a customer.' },
  'pos.saleComplete': { bn: 'বিক্রয় সম্পন্ন হয়েছে', en: 'Sale complete' },
  'pos.receipt': { bn: 'পিওএস রশিদ', en: 'POS Receipt' },
  'pos.printReceipt': { bn: 'রশিদ প্রিন্ট', en: 'Print Receipt' },
  'pos.newSale': { bn: 'নতুন বিক্রয়', en: 'New Sale' },
  'pos.cashier': { bn: 'ক্যাশিয়ার', en: 'Cashier' },
  'pos.invoice': { bn: 'ইনভয়েস', en: 'Invoice' },
  'pos.thankYou': { bn: 'ধন্যবাদ! আবার আসবেন', en: 'Thank you! Please come again' }
};

@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly language = signal<AppLanguage>('bn');
  /** Resolved appearance (system mode is already collapsed to light/dark). */
  readonly dark = signal<boolean>(false);
  readonly themeMode = signal<ThemeMode>('light');
  readonly accent = signal<AccentKey>('teal');
  readonly accents = ACCENT_PRESETS;
  readonly tableHover = signal<TableHoverTone>('medium');
  readonly tableBorder = signal<TableBorderMode>('soft');
  readonly tableHoverTones = TABLE_HOVER_TONES;
  readonly tableBorderModes = TABLE_BORDER_MODES;
  private systemTheme?: MediaQueryList;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      const lang = localStorage.getItem('sm_lang');
      if (lang === 'en' || lang === 'bn') this.language.set(lang);
      const mode = localStorage.getItem('sm_theme');
      if (mode === 'dark' || mode === 'light' || mode === 'system') this.themeMode.set(mode);
      const accent = localStorage.getItem(ACCENT_KEY);
      if (ACCENT_PRESETS.some(preset => preset.key === accent)) this.accent.set(accent as AccentKey);
      const hover = localStorage.getItem(TABLE_HOVER_KEY);
      if (TABLE_HOVER_TONES.some(tone => tone.key === hover)) this.tableHover.set(hover as TableHoverTone);
      const border = localStorage.getItem(TABLE_BORDER_KEY);
      if (TABLE_BORDER_MODES.some(mode => mode.key === border)) this.tableBorder.set(border as TableBorderMode);
      document.documentElement.lang = this.language();
      this.watchSystemTheme();
      this.applyTheme();
      this.applyAccent();
    } catch {
      // ignore storage restrictions
    }
  }

  t(key: string): string {
    const entry = DICT[key];
    if (!entry) return key;
    return entry[this.language()];
  }

  /** For strings written inline rather than added to DICT. */
  txt(bn: string, en: string): string {
    return this.language() === 'en' ? en : bn;
  }

  setLanguage(lang: AppLanguage) {
    this.language.set(lang);
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    this.persist('sm_lang', lang);
  }

  toggleLanguage() {
    this.setLanguage(this.language() === 'bn' ? 'en' : 'bn');
  }

  setDark(value: boolean) {
    this.setThemeMode(value ? 'dark' : 'light');
  }

  setThemeMode(mode: ThemeMode) {
    this.themeMode.set(mode);
    this.applyTheme();
    this.persist('sm_theme', mode);
  }

  toggleDark() {
    this.setThemeMode(this.dark() ? 'light' : 'dark');
  }

  setAccent(key: AccentKey) {
    this.accent.set(key);
    this.applyAccent();
    this.persist(ACCENT_KEY, key);
  }

  setTableHover(tone: TableHoverTone) {
    this.tableHover.set(tone);
    this.applyTableSkin();
    this.persist(TABLE_HOVER_KEY, tone);
  }

  setTableBorder(mode: TableBorderMode) {
    this.tableBorder.set(mode);
    this.applyTableSkin();
    this.persist(TABLE_BORDER_KEY, mode);
  }

  /** Back to the shop default: teal accent, light mode, medium hover, soft borders. */
  resetTheme() {
    this.setAccent('teal');
    this.setThemeMode('light');
    this.setTableHover('medium');
    this.setTableBorder('soft');
  }

  /** Swatch shown in Settings; follows dark mode so the preview is honest. */
  tableHoverSwatch(tone: TableHoverTone = this.tableHover()): string {
    return this.hoverColor(tone, this.dark());
  }

  private hoverColor(tone: TableHoverTone, dark: boolean): string {
    const preset = ACCENT_PRESETS.find(item => item.key === this.accent()) ?? ACCENT_PRESETS[0];
    return dark
      ? mixHex('#0f172a', preset.shades['500'], HOVER_MIX_DARK[tone])
      : mixHex('#ffffff', preset.shades['600'], HOVER_MIX[tone]);
  }

  private applyAccent() {
    if (typeof document === 'undefined') return;
    const preset = ACCENT_PRESETS.find(item => item.key === this.accent()) ?? ACCENT_PRESETS[0];
    const root = document.documentElement.style;
    for (const shade of ACCENT_SHADES) {
      const value = preset.shades[shade];
      if (value) root.setProperty(`--color-teal-${shade}`, value);
      else root.removeProperty(`--color-teal-${shade}`);
    }
    // Surfaces that cannot use a utility class (sticky table bands, selected
    // rows, grid cards) read these; without them the accent only themed half
    // the app and every hard-coded teal stayed put.
    root.setProperty('--sm-brand', preset.shades['600']);
    root.setProperty('--sm-brand-strong', preset.shades['700']);
    root.setProperty('--sm-row-picked', mixHex('#ffffff', preset.shades['500'], 0.18));
    root.setProperty('--sm-row-picked-hover', mixHex('#ffffff', preset.shades['500'], 0.28));
    root.setProperty('--sm-row-picked-dark', mixHex('#0f172a', preset.shades['500'], 0.3));
    root.setProperty('--sm-row-picked-dark-hover', mixHex('#0f172a', preset.shades['500'], 0.4));
    this.applyTableSkin();
  }

  /** Hover tint + border mode for every data table (see styles.css). */
  private applyTableSkin() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--sm-table-hover', this.hoverColor(this.tableHover(), false));
    root.style.setProperty('--sm-table-hover-dark', this.hoverColor(this.tableHover(), true));
    root.setAttribute('data-sm-border', this.tableBorder());
  }

  /** Applies the stored appearance; public so bootstrap can re-apply after hydration. */
  applyTheme() {
    if (typeof document === 'undefined') return;
    const mode = this.themeMode();
    const dark = mode === 'dark' || (mode === 'system' && !!this.systemTheme?.matches);
    this.dark.set(dark);
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    // Native form controls, scrollbars and the mobile browser chrome follow this.
    root.style.colorScheme = dark ? 'dark' : 'light';
  }

  private watchSystemTheme(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (this.themeMode() === 'system') this.applyTheme();
    };
    if (typeof this.systemTheme.addEventListener === 'function') this.systemTheme.addEventListener('change', onChange);
    else this.systemTheme.addListener(onChange);
  }

  private persist(key: string, value: string) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
}
