import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';

type MenuArea = 'reports' | 'accounts' | 'settings' | 'pos' | 'hrm';

interface MenuChild {
  title: string;
  route?: string;
  key: string;
  queryParams?: Record<string, string>;
  area?: MenuArea;
  children?: MenuChild[];
}

interface MenuItem {
  title: string;
  icon: string;
  key: string;
  route?: string;
  badge?: string;
  area?: MenuArea;
  children?: MenuChild[];
  isOpen?: boolean;
}

const DEFAULT_TAB: Record<string, string> = {
  '/parties': 'All'
};

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, MatIconModule],
  styles: [`
    .sb-scroll { scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
    .sb-scroll::-webkit-scrollbar { width: 4px; }
    .sb-scroll::-webkit-scrollbar-track { background: transparent; }
    .sb-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 9999px; }
    :host-context(.dark) .sb-scroll { scrollbar-color: #334155 transparent; }
    :host-context(.dark) .sb-scroll::-webkit-scrollbar-thumb { background: #334155; }
  `],
  template: `
    <aside
      [class]="'fixed lg:sticky top-14 left-0 h-[calc(100dvh-3.5rem)] shrink-0 z-30 flex flex-col transition-all duration-300 ease-in-out select-none overflow-hidden border-r shadow-2xl lg:shadow-none ' +
        (isOpen() ? 'translate-x-0' : '-translate-x-full lg:translate-x-0') + ' ' +
        (isCollapsed() ? 'w-72 lg:w-16' : 'w-72 lg:w-64') + ' ' +
        'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'"
    >
      <!-- Search / Collapse bar -->
      <div class="p-2.5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-1.5 shrink-0">
        @if (!isCollapsed()) {
          <div class="relative flex-1 flex items-center">
            <mat-icon class="absolute left-2.5 text-slate-400 dark:text-slate-500 text-sm pointer-events-none">search</mat-icon>
            <input
              type="text"
              [placeholder]="prefs.t('nav.searchMenu')"
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              (keydown.escape)="clearSearch()"
              class="w-full bg-slate-100/80 dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 pl-8 pr-7 py-1.5 rounded-lg border border-transparent dark:border-slate-800 focus:outline-none focus:border-teal-500/60 focus:bg-white dark:focus:bg-slate-900 transition-colors"
            />
            @if (searchQuery()) {
              <button
                type="button"
                (click)="clearSearch()"
                class="absolute right-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded cursor-pointer"
                [title]="prefs.language() === 'bn' ? 'মুছুন' : 'Clear'"
              >
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            }
          </div>
          <button
            type="button"
            (click)="toggleCollapse.emit()"
            class="hidden lg:grid place-items-center text-slate-400 hover:text-slate-700 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            [title]="prefs.language() === 'bn' ? 'আইকন মোডে ছোট করুন' : 'Collapse to icon mode'"
          >
            <mat-icon class="text-lg">first_page</mat-icon>
          </button>
        } @else {
          <button
            type="button"
            (click)="toggleCollapse.emit()"
            class="w-full flex items-center justify-center text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-white p-2 rounded-lg hover:bg-teal-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            [title]="prefs.language() === 'bn' ? 'পুরো মেনু খুলুন' : 'Expand full menu'"
          >
            <mat-icon class="text-xl">menu_open</mat-icon>
          </button>
        }
      </div>

      <!-- Menu -->
      <nav class="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 space-y-1 sb-scroll text-xs" (scroll)="popover.set(null)">
        @for (item of filteredMenuItems(); track item.title) {

          @if (!item.children) {
            <!-- Single link -->
            <a
              [routerLink]="item.route"
              (click)="onLinkClick()"
              [title]="isCollapsed() ? label(item) : ''"
              [class]="isLinkActive(item)
                ? 'flex items-center gap-3 rounded-lg bg-teal-600 text-white font-semibold shadow-sm shadow-teal-900/20 transition-colors group relative' + (isCollapsed() ? ' justify-center px-0 py-2.5' : ' px-3 py-2.5')
                : 'flex items-center gap-3 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white transition-colors group relative' + (isCollapsed() ? ' justify-center px-0 py-2.5' : ' px-3 py-2.5')"
            >
              <mat-icon [class]="iconClass(isLinkActive(item), false)" class="text-lg shrink-0">{{ item.icon }}</mat-icon>

              @if (!isCollapsed()) {
                <span class="flex-1 truncate">{{ label(item) }}</span>
                @if (item.badge) {
                  <span
                    [class]="isLinkActive(item)
                      ? 'bg-white/20 text-white'
                      : 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300'"
                    class="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0"
                  >
                    {{ badgeText(item.badge) }}
                  </span>
                }
              } @else if (item.badge) {
                <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-teal-400"></span>
              }
            </a>
          } @else {
            <!-- Group -->
            <div>
              <button
                type="button"
                (click)="toggleChildMenu(item, $event)"
                [title]="isCollapsed() ? label(item) : ''"
                [class]="(isGroupActive(item)
                  ? 'w-full flex items-center gap-3 rounded-lg text-teal-700 dark:text-teal-300 bg-teal-50/80 dark:bg-teal-500/10 font-semibold transition-colors group relative text-left cursor-pointer'
                  : 'w-full flex items-center gap-3 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white transition-colors group relative text-left cursor-pointer')
                  + (isCollapsed() ? ' justify-center px-0 py-2.5' : ' px-3 py-2.5')"
                [class.sb-group-trigger]="true"
                [attr.aria-expanded]="isCollapsed() ? popover()?.title === item.title : isGroupOpen(item)"
              >
                <mat-icon [class]="iconClass(false, isGroupActive(item))" class="text-lg shrink-0">{{ item.icon }}</mat-icon>

                @if (!isCollapsed()) {
                  <span class="flex-1 truncate">{{ label(item) }}</span>
                  <mat-icon
                    class="text-slate-400 dark:text-slate-500 text-sm transition-transform duration-200 shrink-0"
                    [class.rotate-180]="isGroupOpen(item)"
                  >
                    expand_more
                  </mat-icon>
                }
              </button>

              <!-- Expanded submenu -->
              @if (!isCollapsed() && isGroupOpen(item)) {
                <div class="mt-1 mb-1 ml-4 pl-3 border-l border-slate-200 dark:border-slate-800 space-y-0.5">
                  @for (child of item.children; track child.title) {
                    @if (child.children; as grands) {
                      <div class="pt-1">
                        @if (child.route) {
                          <a
                            [routerLink]="child.route"
                            [queryParams]="child.queryParams || {}"
                            (click)="onLinkClick()"
                            [class]="childLinkClass(child, false, true)"
                          >
                            {{ prefs.t(child.key) }}
                          </a>
                        } @else {
                          <p class="px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-400">{{ prefs.t(child.key) }}</p>
                        }
                        <div class="ml-2 pl-2 border-l border-slate-200 dark:border-slate-800 space-y-0.5">
                          @for (grand of grands; track grand.title) {
                            <a
                              [routerLink]="grand.route"
                              [queryParams]="grand.queryParams || {}"
                              (click)="onLinkClick()"
                              [class]="childLinkClass(grand, true)"
                            >
                              <span class="inline-flex items-center gap-1">
                                <mat-icon class="text-[13px] w-[13px] h-[13px] text-slate-300 dark:text-slate-600">subdirectory_arrow_right</mat-icon>
                                {{ prefs.t(grand.key) }}
                              </span>
                            </a>
                          }
                        </div>
                      </div>
                    } @else {
                      <a
                        [routerLink]="child.route"
                        [queryParams]="child.queryParams || {}"
                        (click)="onLinkClick()"
                        [class]="childLinkClass(child)"
                      >
                        {{ prefs.t(child.key) }}
                      </a>
                    }
                  }
                </div>
              }
            </div>
          }
        } @empty {
          <div class="px-3 py-8 text-center text-slate-400 dark:text-slate-500">
            <mat-icon class="text-2xl block mx-auto mb-1 text-slate-300 dark:text-slate-600">search_off</mat-icon>
            {{ prefs.language() === 'bn' ? 'কোনো মেনু পাওয়া যায়নি' : 'No menu found' }}
          </div>
        }
      </nav>

      <!-- User / Logout -->
      <div class="p-2 border-t border-slate-100 dark:border-slate-800/80 shrink-0">
        @if (!isCollapsed()) {
          <div class="flex items-center gap-2 px-2 py-2 mb-1 bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 rounded-lg">
            <div class="w-7 h-7 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-[11px] uppercase shrink-0 overflow-hidden">
              @if (session.currentUser()?.photo) {
                <img [src]="session.currentUser()?.photo" alt="" class="w-full h-full object-cover" />
              } @else {
                {{ initial() }}
              }
            </div>
            <div class="min-w-0">
              <p class="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{{ session.currentUser()?.name }}</p>
              <p class="text-[10px] text-teal-600 dark:text-teal-400 truncate">{{ roleLabel() }}</p>
            </div>
          </div>
          <button
            type="button"
            (click)="logout()"
            class="w-full flex items-center gap-2 px-3 py-2 text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors font-medium text-xs cursor-pointer"
          >
            <mat-icon class="text-sm">logout</mat-icon>
            <span>{{ prefs.t('nav.logout') }}</span>
          </button>
        } @else {
          <div class="flex flex-col items-center gap-1">
            <div
              class="w-7 h-7 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-[11px] uppercase shrink-0 overflow-hidden"
              [title]="session.currentUser()?.name || ''"
            >
              @if (session.currentUser()?.photo) {
                <img [src]="session.currentUser()?.photo" alt="" class="w-full h-full object-cover" />
              } @else {
                {{ initial() }}
              }
            </div>
            <button
              type="button"
              (click)="logout()"
              class="w-full flex items-center justify-center text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 p-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
              [title]="prefs.t('nav.logout')"
            >
              <mat-icon class="text-lg">logout</mat-icon>
            </button>
          </div>
        }
      </div>
    </aside>

    <!-- Collapsed mode submenu popover (fixed so the nav scroll container cannot clip it) -->
    @if (isCollapsed() && popover(); as pop) {
      @if (popoverItem(); as menu) {
        <div
          class="sb-popover fixed z-50 w-56 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden text-xs"
          [style.top.px]="pop.top"
          [style.left.px]="pop.left"
        >
          <div class="px-3 py-2 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 font-bold text-teal-700 dark:text-teal-300">
            <mat-icon class="text-sm">{{ menu.icon }}</mat-icon>
            <span class="truncate">{{ label(menu) }}</span>
          </div>
          <div class="p-1 space-y-0.5 max-h-[60vh] overflow-y-auto sb-scroll">
            @for (child of menu.children; track child.title) {
              @if (child.children; as grands) {
                @if (child.route) {
                  <a
                    [routerLink]="child.route"
                    [queryParams]="child.queryParams || {}"
                    (click)="onLinkClick()"
                    [class]="childLinkClass(child, false, true)"
                  >
                    {{ prefs.t(child.key) }}
                  </a>
                } @else {
                  <p class="px-3 pt-1.5 pb-0.5 text-[9.5px] font-black uppercase tracking-wide text-slate-400">{{ prefs.t(child.key) }}</p>
                }
                @for (grand of grands; track grand.title) {
                  <a
                    [routerLink]="grand.route"
                    [queryParams]="grand.queryParams || {}"
                    (click)="onLinkClick()"
                    [class]="childLinkClass(grand, true)"
                  >
                    {{ prefs.t(grand.key) }}
                  </a>
                }
              } @else {
                <a
                  [routerLink]="child.route"
                  [queryParams]="child.queryParams || {}"
                  (click)="onLinkClick()"
                  [class]="childLinkClass(child)"
                >
                  {{ prefs.t(child.key) }}
                </a>
              }
            }
          </div>
        </div>
      }
    }
  `
})
export class Sidebar {
  readonly isOpen = input<boolean>(true);
  readonly isCollapsed = input<boolean>(false);
  readonly closeMobile = output<void>();
  readonly toggleCollapse = output<void>();

  prefs = inject(PreferencesService);
  private notify = inject(NotificationService);
  session = inject(SessionService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly searchQuery = signal<string>('');
  readonly popover = signal<{ title: string; top: number; left: number } | null>(null);
  private readonly currentUrl = signal<string>(this.router.url);

  readonly isSearching = computed(() => this.searchQuery().trim().length > 0);

  readonly popoverItem = computed(() => {
    const pop = this.popover();
    if (!pop) return null;
    return this.menuItems().find(m => m.title === pop.title) ?? null;
  });

  menuItems = signal<MenuItem[]>([
    { title: 'Dashboard', key: 'nav.dashboard', icon: 'grid_view', route: '/dashboard' },
    { title: 'Wallet', key: 'nav.wallet', icon: 'account_balance_wallet', route: '/wallet' },
    {
      title: 'Parties',
      key: 'nav.parties',
      icon: 'groups',
      isOpen: false,
      children: [
        { title: 'Parties', key: 'nav.partiesAll', route: '/parties', queryParams: { tab: 'All' } },
        { title: 'Customers', key: 'nav.customers', route: '/parties', queryParams: { tab: 'Customer' } },
        { title: 'Corporate Customers', key: 'nav.corporate', route: '/parties', queryParams: { tab: 'Corporate Customer' } },
        { title: 'Suppliers', key: 'nav.suppliers', route: '/parties', queryParams: { tab: 'Supplier' } },
        { title: 'Dealers', key: 'nav.dealers', route: '/parties', queryParams: { tab: 'Dealer' } },
        { title: 'Staff Members', key: 'nav.staff', route: '/parties', queryParams: { tab: 'Staff Member' } }
      ]
    },
    {
      title: 'HRM',
      key: 'nav.hrm',
      icon: 'badge',
      isOpen: false,
      children: [
        { title: 'Employee Info', key: 'nav.employees', route: '/hrm/staff', area: 'hrm' },
        { title: 'Attendance', key: 'nav.attendance', route: '/hrm/attendance', area: 'hrm' },
        { title: 'Leave', key: 'nav.leave', route: '/hrm/leave', area: 'hrm' },
        { title: 'Salary', key: 'nav.payroll', route: '/hrm/salary', area: 'hrm' },
        { title: 'Staff Advance', key: 'nav.staffAdvance', route: '/hrm/staff-advance', area: 'hrm' },
        { title: 'Shop Rent', key: 'nav.shopRent', route: '/hrm/rent', area: 'hrm' },
        { title: 'Daily Expense', key: 'nav.dailyExpense', route: '/hrm/expenses', area: 'hrm' }
      ]
    },
    {
      title: 'Product Manager',
      key: 'nav.productManager',
      icon: 'inventory_2',
      isOpen: false,
      children: [
        { title: 'Brands', key: 'nav.brands', route: '/product-manager/brands' },
        { title: 'Product Models', key: 'nav.models', route: '/product-manager/models' },
        { title: 'Categories', key: 'nav.categories', route: '/product-manager/categories' },
        { title: 'Sub Categories', key: 'nav.subCategories', route: '/product-manager/sub-categories' },
        { title: 'Variations', key: 'nav.variations', route: '/product-manager/variations' },
        { title: 'Products', key: 'nav.products', route: '/product-manager/products' },
        { title: 'Print Barcode', key: 'nav.printBarcode', route: '/product-manager/print-barcode' }
      ]
    },
    {
      title: 'Warranty Management',
      key: 'nav.warrantySystem',
      icon: 'verified_user',
      isOpen: false,
      children: [
        { title: 'Warranty Receiving', key: 'nav.warrantyReceive', route: '/warranty/receive' },
        { title: 'Warranty Replacement', key: 'nav.warrantyReplace', route: '/warranty/replace' },
        { title: 'Warranty Stock', key: 'nav.warrantyStock', route: '/warranty/stock' },
        { title: 'Stock Movement History', key: 'nav.warrantyStockLedger', route: '/warranty/stock/ledger' },
        { title: 'Product Warranty', key: 'nav.warranty', route: '/product-manager/warranty' },
        { title: 'Customize Warranty', key: 'nav.warrantySettings', route: '/warranty/settings', area: 'settings' }
      ]
    },
    {
      title: 'Sales',
      key: 'nav.sales',
      icon: 'shopping_cart',
      isOpen: false,
      children: [
        { title: 'Sales', key: 'nav.salesList', route: '/sales' },
        { title: 'Add Sale', key: 'nav.addSale', route: '/sales/add' },
        { title: 'Sales Return / Cr. Note', key: 'nav.salesReturn', route: '/sales/returns' },
        { title: 'Payment In', key: 'nav.paymentIn', route: '/sales/payment-in' }
      ]
    },
    {
      title: 'Purchases',
      key: 'nav.purchases',
      icon: 'shopping_bag',
      isOpen: false,
      children: [
        { title: 'New Purchase', key: 'nav.addPurchase', route: '/purchases/add' },
        { title: 'Purchases', key: 'nav.purchasesList', route: '/purchases' },
        { title: 'Purchase Return / Dr. Note', key: 'nav.purchaseReturn', route: '/purchases/returns' },
        { title: 'Online Requests', key: 'nav.onlineRequests', route: '/purchases/online-requests' },
        { title: 'Payment Out', key: 'nav.paymentOut', route: '/purchases/payment-out' }
      ]
    },
    { title: 'Damage', key: 'nav.damage', icon: 'warning', route: '/damage' },
    {
      title: 'Old Battery Management',
      key: 'nav.battery',
      icon: 'recycling',
      isOpen: false,
      children: [
        {
          title: 'Old Battery Purchase',
          key: 'nav.batteryPurchase',
          route: '/battery/purchase',
          children: [
            { title: 'Battery Purchase Vouchers', key: 'nav.batteryPurchaseVouchers', route: '/battery/purchase/vouchers' }
          ]
        },
        {
          title: 'Old Battery Sale (kg/pcs)',
          key: 'nav.batterySale',
          route: '/battery/sale',
          children: [
            { title: 'Battery Sale Vouchers', key: 'nav.batterySaleVouchers', route: '/battery/sale/vouchers' }
          ]
        },
        {
          title: 'Old Battery Exchange',
          key: 'nav.batteryExchange',
          route: '/battery/exchange',
          children: [
            { title: 'Battery Exchange Vouchers', key: 'nav.batteryExchangeVouchers', route: '/battery/exchange/vouchers' }
          ]
        },
        { title: 'Stock Ledger', key: 'nav.batteryLedger', route: '/battery/ledger' }
      ]
    },
    { title: 'Stock', key: 'nav.stock', icon: 'warehouse', route: '/stock' },
    { title: 'POS', key: 'nav.pos', icon: 'point_of_sale', route: '/pos', badge: 'Active', area: 'pos' },
    {
      title: 'Accounts',
      key: 'nav.accounts',
      icon: 'account_balance',
      isOpen: false,
      area: 'accounts',
      children: [
        { title: 'Accounts Summary', key: 'nav.accountsSummary', route: '/accounts' },
        { title: 'Cash & Bank', key: 'nav.cashBank', route: '/cash-bank' },
        { title: 'Day Book', key: 'nav.dayBook', route: '/cash-bank/day-book' },
        { title: 'Closing History', key: 'nav.closingHistory', route: '/cash-bank/history' }
      ]
    },
    { title: 'Reports', key: 'nav.reports', icon: 'insights', route: '/reports', area: 'reports' },
    { title: 'Recycle Bin', key: 'nav.recycleBin', icon: 'delete', route: '/recycle-bin', area: 'settings' },
    { title: 'Settings', key: 'nav.settings', icon: 'settings', route: '/settings', area: 'settings' },
    { title: 'App Info', key: 'nav.appInfo', icon: 'menu_book', route: '/app-info' }
  ]);

  readonly filteredMenuItems = computed<MenuItem[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    return this.menuItems()
      .filter(item => this.canView(item))
      .map(item => {
        const children = item.children?.filter(child => this.canView(child));
        const base: MenuItem = children ? { ...item, children } : item;
        if (!q) return base;
        const selfHit = `${this.label(base)} ${base.title}`.toLowerCase().includes(q);
        if (!base.children?.length) return selfHit ? base : null;
        const hits = this.filterChildren(base.children, q);
        if (!selfHit && !hits.length) return null;
        return { ...base, children: selfHit ? base.children : hits };
      })
      .filter((item): item is MenuItem => item !== null);
  });

  private menuHit(child: MenuChild, q: string): boolean {
    return `${this.prefs.t(child.key)} ${child.title}`.toLowerCase().includes(q);
  }

  private filterChildren(children: MenuChild[], q: string): MenuChild[] {
    return children
      .filter(child => this.canView(child))
      .map(child => {
        if (!child.children?.length) return this.menuHit(child, q) ? child : null;
        const selfHit = this.menuHit(child, q);
        const nested = this.filterChildren(child.children, q);
        if (!selfHit && !nested.length) return null;
        return { ...child, children: selfHit ? child.children : nested };
      })
      .filter((child): child is MenuChild => child !== null);
  }

  private leafCount(children: MenuChild[]): number {
    return children.reduce((acc, child) => acc + (child.children?.length ? this.leafCount(child.children) : 1), 0);
  }

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(e => {
        this.currentUrl.set(e.urlAfterRedirects);
        this.popover.set(null);
        this.syncActiveGroups();
      });

    effect(() => {
      if (!this.isCollapsed()) this.popover.set(null);
    });

    this.syncActiveGroups();
  }

  canView(item: { area?: MenuArea }): boolean {
    if (!item.area) return true;
    return this.session.canSee(item.area);
  }

  label(item: MenuItem): string {
    return this.prefs.t(item.key) || item.title;
  }

  badgeText(badge: string): string {
    if (badge === 'Active') return this.prefs.language() === 'bn' ? 'সক্রিয়' : 'Active';
    return badge;
  }

  initial(): string {
    const name = this.session.currentUser()?.name || 'U';
    return name.trim().charAt(0);
  }

  roleLabel(): string {
    const role = this.session.currentUser()?.role;
    if (role === 'Admin') return this.prefs.t('role.admin');
    if (role === 'Salesman') return this.prefs.t('role.salesman');
    if (role === 'Accountant') return this.prefs.t('role.accountant');
    return '';
  }

  iconClass(active: boolean, parentActive: boolean): string {
    if (active) return 'text-white';
    if (parentActive) return 'text-teal-600 dark:text-teal-400';
    return 'text-slate-400 dark:text-slate-500 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors';
  }

  childLinkClass(child: MenuChild, nested = false, group = false): string {
    const base = nested
      ? 'block px-3 py-1 rounded-md truncate transition-colors text-[11.5px]'
      : group
        ? 'block px-3 py-1.5 rounded-md truncate transition-colors font-semibold'
        : 'block px-3 py-1.5 rounded-md truncate transition-colors';
    const active = this.isLinkActive(child) || (group && !!child.children?.some(grand => this.isLinkActive(grand)));
    return active
      ? `${base} bg-teal-600/10 dark:bg-teal-400/10 text-teal-700 dark:text-teal-300 font-semibold`
      : `${base} text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/70`;
  }


  isLinkActive(link: { route?: string; queryParams?: Record<string, string> }): boolean {
    if (!link.route) return false;
    const [path, search] = this.currentUrl().split('?');
    if (path !== link.route) return false;

    const current = new URLSearchParams(search || '');
    const wanted = link.queryParams || {};
    const entries = Object.entries(wanted);
    if (!entries.length) return true;

    if (!current.get('tab') && entries.length === 1 && entries[0][0] === 'tab' && DEFAULT_TAB[link.route] === entries[0][1]) {
      return true;
    }
    return entries.every(([key, value]) => current.get(key) === value);
  }

  isGroupActive(item: MenuItem): boolean {
    return !!item.children?.some(child =>
      this.isLinkActive(child) || !!child.children?.some(grand => this.isLinkActive(grand))
    );
  }

  isGroupOpen(item: MenuItem): boolean {
    return this.isSearching() || !!item.isOpen;
  }

  onSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  clearSearch() {
    this.searchQuery.set('');
  }

  toggleChildMenu(item: MenuItem, event: MouseEvent) {
    if (this.isCollapsed()) {
      if (this.popover()?.title === item.title) {
        this.popover.set(null);
        return;
      }
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const rows = Math.min(item.children ? this.leafCount(item.children) : 0, 12);
      const height = rows * 30 + 46;
      const viewport = typeof window !== 'undefined' ? window.innerHeight : 800;
      const top = Math.max(8, Math.min(rect.top, viewport - height - 8));
      this.popover.set({ title: item.title, top, left: rect.right + 8 });
      return;
    }

    this.menuItems.update(list =>
      list.map(m => (m.title === item.title ? { ...m, isOpen: !m.isOpen } : m))
    );
  }

  onLinkClick() {
    this.popover.set(null);
    this.searchQuery.set('');
    this.closeMobile.emit();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.sb-popover') && !target.closest('.sb-group-trigger')) {
      this.popover.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.popover.set(null);
  }

  async logout() {
    const confirmed = await this.notify.confirm(this.prefs.txt('চালিয়ে যেতে আবার সাইন ইন করতে হবে।', 'You will need to sign in again to continue.'), {
      title: this.prefs.txt('লগ আউট করবেন?', 'Log out?'),
      kind: 'warning',
      confirmText: this.prefs.txt('লগ আউট', 'Log out')
    });
    if (confirmed) {
      this.session.logout();
    }
  }

  private syncActiveGroups() {
    const activeTitles = new Set(
      this.menuItems().filter(item => this.isGroupActive(item)).map(item => item.title)
    );
    if (!activeTitles.size) return;
    this.menuItems.update(list =>
      list.map(item => (activeTitles.has(item.title) ? { ...item, isOpen: true } : item))
    );
  }
}
