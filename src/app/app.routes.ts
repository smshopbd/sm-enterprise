import { Routes } from '@angular/router';
import { restrictTo } from './guards/restrict-to';
import { unsavedChangesGuard } from './guards/unsaved-changes';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
  { path: 'parties', loadComponent: () => import('./pages/parties/parties').then(m => m.Parties) },
  {
    path: 'product-manager',
    children: [
      { path: 'brands', loadComponent: () => import('./pages/product-manager/brands/brands').then(m => m.Brands) },
      { path: 'models', loadComponent: () => import('./pages/product-manager/models/models').then(m => m.Models) },
      { path: 'categories', loadComponent: () => import('./pages/product-manager/categories/categories').then(m => m.Categories) },
      { path: 'sub-categories', loadComponent: () => import('./pages/product-manager/sub-categories/sub-categories').then(m => m.SubCategories) },
      { path: 'variations', loadComponent: () => import('./pages/product-manager/variations/variations').then(m => m.Variations) },
      { path: 'products', loadComponent: () => import('./pages/product-manager/products/products').then(m => m.Products) },
      { path: 'warranty', loadComponent: () => import('./pages/product-manager/warranty/warranty').then(m => m.Warranty) },
      { path: 'print-barcode', loadComponent: () => import('./pages/product-manager/print-barcode/print-barcode').then(m => m.PrintBarcode) }
    ]
  },
  {
    path: 'warranty',
    children: [
      { path: '', redirectTo: 'receive', pathMatch: 'full' },
      { path: 'receive', canDeactivate: [unsavedChangesGuard], data: { warrantyView: 'list' }, loadComponent: () => import('./pages/warranty/warranty-receive/warranty-receive').then(m => m.WarrantyReceive) },
      { path: 'receive/new', canDeactivate: [unsavedChangesGuard], data: { warrantyView: 'form' }, loadComponent: () => import('./pages/warranty/warranty-receive/warranty-receive').then(m => m.WarrantyReceive) },
      { path: 'receive/:id/edit', canDeactivate: [unsavedChangesGuard], data: { warrantyView: 'form' }, loadComponent: () => import('./pages/warranty/warranty-receive/warranty-receive').then(m => m.WarrantyReceive) },
      { path: 'replace', canDeactivate: [unsavedChangesGuard], data: { warrantyView: 'list' }, loadComponent: () => import('./pages/warranty/warranty-replace/warranty-replace').then(m => m.WarrantyReplace) },
      { path: 'replace/new', canDeactivate: [unsavedChangesGuard], data: { warrantyView: 'form' }, loadComponent: () => import('./pages/warranty/warranty-replace/warranty-replace').then(m => m.WarrantyReplace) },
      { path: 'replace/:id/edit', canDeactivate: [unsavedChangesGuard], data: { warrantyView: 'form' }, loadComponent: () => import('./pages/warranty/warranty-replace/warranty-replace').then(m => m.WarrantyReplace) },
      { path: 'stock', data: { stockView: 'balances' }, loadComponent: () => import('./pages/warranty/warranty-stock/warranty-stock').then(m => m.WarrantyStock) },
      { path: 'stock/ledger', data: { stockView: 'ledger' }, loadComponent: () => import('./pages/warranty/warranty-stock/warranty-stock').then(m => m.WarrantyStock) },
      { path: 'settings', canActivate: [restrictTo('settings')], canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/warranty/warranty-settings/warranty-settings').then(m => m.WarrantySettingsPage) }
    ]
  },
  {
    path: 'sales',
    children: [
      { path: '', loadComponent: () => import('./pages/sales/sales-list/sales-list').then(m => m.SalesList) },
      { path: 'add', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/sales/add-sale/add-sale').then(m => m.AddSale) },
      { path: 'staff-advance', redirectTo: '/hrm/staff-advance', pathMatch: 'full' },
      { path: 'returns', loadComponent: () => import('./pages/sales/sales-returns/sales-returns').then(m => m.SalesReturns) },
      { path: 'returns/add', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/sales/sales-return-add/sales-return-add').then(m => m.SalesReturnAdd) },
      { path: 'payment-in', loadComponent: () => import('./pages/sales/payment-in/payment-in').then(m => m.PaymentIn) }
    ]
  },
  {
    path: 'purchases',
    children: [
      { path: '', loadComponent: () => import('./pages/purchases/purchases-list/purchases-list').then(m => m.PurchasesList) },
      { path: 'add', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/purchases/add-purchase/add-purchase').then(m => m.AddPurchase) },
      { path: 'returns', loadComponent: () => import('./pages/purchases/purchase-returns/purchase-returns').then(m => m.PurchaseReturns) },
      { path: 'returns/add', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/purchases/purchase-return-add/purchase-return-add').then(m => m.PurchaseReturnAdd) },
      { path: 'online-requests', loadComponent: () => import('./pages/purchases/online-requests/online-requests').then(m => m.OnlineRequests) },
      { path: 'payment-out', loadComponent: () => import('./pages/purchases/payment-out/payment-out').then(m => m.PaymentOut) }
    ]
  },
  {
    path: 'battery',
    children: [
      { path: 'purchase', data: { batteryType: 'purchase', batteryView: 'entry' }, canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/battery/battery-vouchers').then(m => m.BatteryVouchers) },
      { path: 'purchase/vouchers', data: { batteryType: 'purchase', batteryView: 'vouchers' }, loadComponent: () => import('./pages/battery/battery-vouchers').then(m => m.BatteryVouchers) },
      { path: 'sale', data: { batteryType: 'sale', batteryView: 'entry' }, canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/battery/battery-vouchers').then(m => m.BatteryVouchers) },
      { path: 'sale/vouchers', data: { batteryType: 'sale', batteryView: 'vouchers' }, loadComponent: () => import('./pages/battery/battery-vouchers').then(m => m.BatteryVouchers) },
      { path: 'exchange', data: { batteryType: 'exchange', batteryView: 'entry' }, canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/battery/battery-vouchers').then(m => m.BatteryVouchers) },
      { path: 'exchange/vouchers', data: { batteryType: 'exchange', batteryView: 'vouchers' }, loadComponent: () => import('./pages/battery/battery-vouchers').then(m => m.BatteryVouchers) },
      { path: 'ledger', data: { batteryView: 'ledger' }, loadComponent: () => import('./pages/battery/battery-vouchers').then(m => m.BatteryVouchers) }
    ]
  },
  { path: 'pos', canActivate: [restrictTo('pos')], canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./pages/pos/pos').then(m => m.Pos) },
  { path: 'stock', loadComponent: () => import('./pages/stock/stock').then(m => m.Stock) },
  { path: 'wallet', canActivate: [restrictTo('accounts')], loadComponent: () => import('./pages/wallet/wallet').then(m => m.Wallet) },
  {
    path: 'hrm',
    children: [
      { path: '', redirectTo: 'staff', pathMatch: 'full' },
      { path: 'staff', canActivate: [restrictTo('hrm')], loadComponent: () => import('./pages/hrm/hrm').then(m => m.Hrm) },
      { path: 'attendance', canActivate: [restrictTo('hrm')], loadComponent: () => import('./pages/hrm/attendance').then(m => m.HrmAttendance) },
      { path: 'leave', canActivate: [restrictTo('hrm')], loadComponent: () => import('./pages/hrm/leave').then(m => m.HrmLeavePage) },
      { path: 'staff-advance', canActivate: [restrictTo('hrm')], loadComponent: () => import('./pages/hrm/staff-advance').then(m => m.StaffAdvance) },
      { path: 'salary', canActivate: [restrictTo('hrm')], loadComponent: () => import('./pages/hrm/salary').then(m => m.HrmSalary) },
      { path: 'rent', canActivate: [restrictTo('hrm')], loadComponent: () => import('./pages/hrm/rent').then(m => m.HrmRent) },
      { path: 'expenses', canActivate: [restrictTo('hrm')], loadComponent: () => import('./pages/hrm/expenses').then(m => m.HrmExpenses) }
    ]
  },
  { path: 'damage', loadComponent: () => import('./pages/damage/damage').then(m => m.Damage) },
  { path: 'accounts', canActivate: [restrictTo('accounts')], loadComponent: () => import('./pages/accounts/accounts').then(m => m.Accounts) },
  {
    path: 'cash-bank',
    canActivate: [restrictTo('accounts')],
    children: [
      { path: '', data: { cashView: 'summary' }, loadComponent: () => import('./pages/cash-bank/cash-bank').then(m => m.CashBank) },
      { path: 'day-book', data: { cashView: 'daybook' }, loadComponent: () => import('./pages/cash-bank/cash-bank').then(m => m.CashBank) },
      { path: 'history', data: { cashView: 'history' }, loadComponent: () => import('./pages/cash-bank/cash-bank').then(m => m.CashBank) }
    ]
  },
  { path: 'reports', canActivate: [restrictTo('reports')], loadComponent: () => import('./pages/reports/reports').then(m => m.Reports) },
  { path: 'recycle-bin', canActivate: [restrictTo('users')], loadComponent: () => import('./pages/recycle-bin/recycle-bin').then(m => m.RecycleBin) },
  { path: 'settings', canActivate: [restrictTo('settings')], loadComponent: () => import('./pages/settings/settings').then(m => m.Settings) },
  { path: 'app-info', loadComponent: () => import('./pages/app-info/app-info').then(m => m.AppInfo) },
  { path: 'scan', loadComponent: () => import('./pages/attendance-scan/attendance-scan').then(m => m.AttendanceScan) },
  { path: 'v/:type/:key', loadComponent: () => import('./pages/voucher-view/voucher-view').then(m => m.VoucherView) },
  { path: '**', redirectTo: 'dashboard' }
];
