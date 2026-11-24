import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  output,
  viewChild,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { DataService } from '../../services/data';
import { NotificationService } from '../../services/notification';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { CalculatorModal } from '../calculator-modal/calculator-modal';
import { LoadingService } from '../../services/loading';
import { CloudService } from '../../services/cloud';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, MatIconModule, CalculatorModal],
  template: `
    <header class="bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white h-14 flex items-center justify-between px-3 sm:px-4 sticky top-0 z-40 select-none shadow-sm dark:shadow-md shrink-0">

      <!-- Left Side: Menu Toggle + Brand + Live Clock -->
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <button (click)="toggleSidebar.emit()" class="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-lg transition-colors focus:outline-none shrink-0" [title]="prefs.txt('মেনু', 'Menu')">
          <mat-icon>menu</mat-icon>
        </button>

        <a routerLink="/dashboard" class="flex items-center gap-2 min-w-0 font-extrabold text-sm sm:text-lg tracking-wide hover:opacity-90">
          <span class="brand-text truncate">{{ prefs.t('app.name') }}</span>
        </a>

        <div class="hidden md:flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-300 lg:gap-2.5 lg:px-4">
          <mat-icon class="shrink-0 text-[15px] text-emerald-600 dark:text-emerald-400">calendar_month</mat-icon>
          <div class="flex min-w-0 flex-col leading-tight">
            <span class="whitespace-nowrap text-[10px] font-semibold text-slate-500 dark:text-slate-400">{{ currentDate() }}</span>
            <span class="whitespace-nowrap text-xs font-mono font-bold">{{ currentTime() }}</span>
          </div>
        </div>
      </div>

      <!-- Quick Action Buttons Bar -->
      <div class="hidden lg:flex flex-1 min-w-0 items-center justify-center gap-1.5 px-2">
        <a routerLink="/dashboard" (click)="closeMenus()" class="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-95 shrink-0">
          <mat-icon class="text-xs">bar_chart</mat-icon>
          <span>{{ prefs.t('nav.dashboard') }}</span>
        </a>

        <a routerLink="/pos" (click)="closeMenus()" class="bg-teal-600 hover:bg-teal-700 dark:hover:bg-teal-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-95 shrink-0">
          <mat-icon class="text-xs">shopping_cart</mat-icon>
          <span>{{ prefs.t('nav.pos') }}</span>
        </a>

        <button (click)="showCalculator.set(true); closeMenus()" class="bg-teal-600 hover:bg-teal-700 dark:hover:bg-teal-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all active:scale-95 shrink-0">
          <mat-icon class="text-xs">calculate</mat-icon>
          <span>{{ prefs.language() === 'bn' ? 'ক্যালকুলেটর' : 'Calculator' }}</span>
        </button>

        <a routerLink="/purchases" (click)="closeMenus()" class="bg-teal-600 hover:bg-teal-700 dark:hover:bg-teal-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all shrink-0">
          <mat-icon class="text-xs">shopping_bag</mat-icon>
          <span>{{ prefs.t('nav.purchases') }}</span>
        </a>

        <a routerLink="/sales" (click)="closeMenus()" class="bg-teal-600 hover:bg-teal-700 dark:hover:bg-teal-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-all shrink-0">
          <mat-icon class="text-xs">point_of_sale</mat-icon>
          <span>{{ prefs.t('nav.sales') }}</span>
        </a>

        <div class="relative shrink-0">
          <button (click)="toggleWarehouseMenu($event)" class="bg-teal-700 dark:bg-teal-600 hover:bg-teal-800 dark:hover:bg-teal-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer transition-colors">
            <mat-icon class="text-xs">store</mat-icon>
            <span>{{ selectedWarehouse() }}</span>
            <mat-icon class="text-xs">expand_more</mat-icon>
          </button>

          @if (showWarehouseDropdown()) {
            <div class="absolute left-0 mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl text-xs text-slate-700 dark:text-slate-200 z-50 overflow-hidden">
              <div class="p-1.5 border-b border-slate-200 dark:border-slate-700">
                <div class="relative">
                  <mat-icon class="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" style="font-size:14px;width:14px;height:14px;">search</mat-icon>
                  <input
                    #warehouseSearch
                    type="text"
                    [value]="warehouseQuery()"
                    (input)="onWarehouseQuery($event)"
                    (keydown)="onWarehouseKeydown($event)"
                    [placeholder]="prefs.txt('ওয়্যারহাউস খুঁজুন…', 'Search warehouse…')"
                    class="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 pl-7 pr-2 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 outline-none focus:border-teal-500"
                  />
                </div>
              </div>
              <div class="py-1 max-h-64 overflow-y-auto">
                @for (w of filteredWarehouses(); track w) {
                  <button (click)="selectWarehouse(w)" class="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer">
                    @if (w === selectedWarehouse()) {
                      <mat-icon class="text-xs text-emerald-600 dark:text-emerald-400">check_circle</mat-icon>
                    } @else {
                      <span class="w-3"></span>
                    }
                    <span class="truncate">{{ w }}</span>
                  </button>
                } @empty {
                  <p class="px-3 py-2 text-slate-400">
                    {{ warehouseQuery().trim()
                      ? prefs.txt('এই নামে কোনো ওয়্যারহাউস নেই', 'No warehouse matches this search')
                      : prefs.txt('কোনো ওয়্যারহাউস নেই', 'No warehouse yet') }}
                  </p>
                }
              </div>
              <div class="border-t border-slate-200 dark:border-slate-700">
                <button (click)="addWarehouse()" class="w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-teal-700 dark:text-teal-400 font-semibold flex items-center gap-2 cursor-pointer">
                  <mat-icon class="text-xs">add</mat-icon>
                  {{ prefs.language() === 'bn' ? 'নতুন ওয়্যারহাউস' : 'New warehouse' }}
                </button>
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Right Side Actions: Language, Theme, Low Stock, Search, Profile -->
      <div class="flex items-center gap-0.5 sm:gap-2 shrink-0">

        @if (loading.syncing()) {
          <span class="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-[10px] font-bold text-teal-700 dark:text-teal-300"
            [title]="prefs.txt('ক্লাউডে সিঙ্ক হচ্ছে…', 'Syncing to cloud…')"
            [attr.aria-label]="prefs.txt('ক্লাউডে সিঙ্ক হচ্ছে', 'Syncing to cloud')">
            <span class="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
            <span class="hidden sm:inline">{{ prefs.txt('সিঙ্ক', 'Sync') }}</span>
          </span>
        } @else if (!loading.online()) {
          <span class="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-[10px] font-bold text-amber-700 dark:text-amber-300"
            [title]="syncProblem() || prefs.txt('ক্লাউডে সংযোগ হচ্ছে না — লোকাল ডেটা নিরাপদ', 'Cloud offline — local data is safe')"
            [attr.aria-label]="syncProblem() || prefs.txt('ক্লাউড অফলাইন', 'Cloud offline')">
            <mat-icon class="text-xs">cloud_off</mat-icon>
            <span class="hidden sm:inline">{{ prefs.txt('সিঙ্ক সমস্যা', 'Sync issue') }}</span>
          </span>
        }

        @if (lastUpdateText()) {
          <span class="hidden md:inline-flex items-center gap-1 px-1.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300"
            [title]="prefs.txt('সর্বশেষ ডাটাবেস আপডেট', 'Last database update')"
            [attr.aria-label]="prefs.txt('সর্বশেষ ডাটাবেস আপডেট', 'Last database update')">
            <mat-icon class="text-xs">cloud_done</mat-icon>
            <span class="hidden lg:inline">{{ prefs.txt('আপডেট', 'Updated') }}</span>
            {{ lastUpdateText() }}
          </span>
        }

        <button (click)="prefs.toggleLanguage()" [title]="prefs.txt('ভাষা', 'Language')"
          class="inline-flex items-center justify-center min-w-7 min-h-7 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-bold transition-colors cursor-pointer">
          {{ prefs.language() === 'bn' ? 'EN' : 'বাং' }}
        </button>

        <button (click)="prefs.toggleDark()" [title]="prefs.txt('থিম', 'Theme')"
          class="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-lg transition-colors cursor-pointer">
          <mat-icon class="text-lg">{{ prefs.dark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
        </button>

        <!-- Stock alerts bell -->
        <div class="relative">
          <button (click)="toggleLowStock($event)" [title]="prefs.txt('স্টক অ্যালার্ট', 'Stock alerts')"
            class="relative text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-lg transition-colors cursor-pointer">
            <mat-icon class="text-lg">{{ alertCount() > 0 ? 'notifications_active' : 'notifications' }}</mat-icon>
            @if (alertCount() > 0) {
              <span class="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[9px] font-bold rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
                {{ alertCount() > 99 ? '99+' : alertCount() }}
              </span>
            }
          </button>

          @if (showLowStock()) {
            <div class="absolute right-0 top-11 w-80 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl text-slate-800 dark:text-slate-200 overflow-hidden z-50">
              <div class="px-3 py-2.5 bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 text-white flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <mat-icon class="text-base">notifications_active</mat-icon>
                  <div>
                    <p class="text-[11px] font-bold leading-tight">{{ prefs.txt('স্টক অ্যালার্ট', 'Stock alerts') }}</p>
                    <p class="text-[9px] text-rose-100 leading-tight">{{ prefs.txt('স্টক শেষ ও ন্যূনতম সীমার নিচে', 'Out of stock and below minimum') }}</p>
                  </div>
                </div>
                <span class="text-[11px] font-black font-mono bg-white/25 rounded-full px-2 py-0.5">{{ alertCount() }}</span>
              </div>

              <div class="grid grid-cols-2 gap-1.5 p-2 border-b border-slate-100 dark:border-slate-800">
                <a routerLink="/product-manager/products" [queryParams]="{ stock: 'out' }" (click)="closeMenus()"
                  class="flex items-center justify-between gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
                  {{ prefs.txt('স্টক শেষ', 'Out of stock') }} <span class="font-mono">{{ outOfStock().length }}</span>
                </a>
                <a routerLink="/product-manager/products" [queryParams]="{ stock: 'low' }" (click)="closeMenus()"
                  class="flex items-center justify-between gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  {{ prefs.txt('কম স্টক', 'Low stock') }} <span class="font-mono">{{ lowStockOnly().length }}</span>
                </a>
              </div>

              <div class="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                @for (p of stockAlerts().slice(0, 8); track p.id) {
                  <a routerLink="/product-manager/products" [queryParams]="{ stock: stockAlertMode(p), q: p.name }" (click)="closeMenus()"
                    class="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                    <div class="min-w-0">
                      <p class="text-[11px] font-semibold truncate">{{ p.name }}</p>
                      <p class="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {{ p.brand }} {{ p.model }}
                        <span class="text-slate-400 dark:text-slate-500">· {{ prefs.txt('সীমা', 'min') }} {{ alertThreshold(p) }}</span>
                      </p>
                    </div>
                    <span class="text-[10px] font-bold font-mono shrink-0 px-1.5 py-0.5 rounded"
                      [class]="p.stock <= 0
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'">
                      {{ p.stock }} {{ p.unit }}
                    </span>
                  </a>
                } @empty {
                  <div class="px-3 py-5 text-center">
                    <mat-icon class="text-emerald-500 text-xl">check_circle</mat-icon>
                    <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ prefs.txt('সব পণ্যের স্টক ঠিক আছে', 'Every product is well stocked') }}</p>
                  </div>
                }
              </div>

              @if (alertCount() > 0) {
                <a routerLink="/product-manager/products" [queryParams]="{ stock: 'low' }" (click)="closeMenus()"
                  class="block border-t border-slate-100 dark:border-slate-800 px-3 py-2 text-center text-[10px] font-bold text-teal-700 dark:text-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800/70">
                  {{ prefs.txt('শুধু কম স্টক পণ্য দেখুন', 'View low-stock products only') }}
                </a>
              }
            </div>
          }
        </div>

        <button (click)="openGlobalSearch()" class="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 p-1.5 rounded-lg transition-colors cursor-pointer">
          <mat-icon class="text-lg">search</mat-icon>
        </button>

        <!-- Profile -->
        <div class="relative flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
          <button (click)="toggleProfile($event)" class="flex items-center gap-2 cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 p-1 transition-colors">
            <div class="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xs ring-2 ring-emerald-400/40 uppercase overflow-hidden shrink-0">
              @if (session.currentUser()?.photo) {
                <img [src]="session.currentUser()?.photo" alt="" class="w-full h-full object-cover" />
              } @else {
                {{ initial() }}
              }
            </div>
            <div class="hidden sm:block text-left text-xs">
              <p class="font-bold text-slate-800 dark:text-slate-200 leading-tight max-w-24 truncate">{{ session.currentUser()?.name }}</p>
              <p class="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">{{ roleLabel() }}</p>
            </div>
            <mat-icon class="text-sm text-slate-500 dark:text-slate-400 hidden sm:block">expand_more</mat-icon>
          </button>

          @if (showProfile()) {
            <div class="absolute right-0 top-12 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl text-slate-800 dark:text-slate-200 overflow-hidden z-50">
              <div class="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
                <p class="text-xs font-bold truncate">{{ session.currentUser()?.name }}</p>
                <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ roleLabel() }} · {{ session.currentUser()?.username }}</p>
              </div>
              @if (session.canSee('settings')) {
                <a routerLink="/settings" (click)="closeMenus()" class="flex items-center gap-2 px-3 py-2 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
                  <mat-icon class="text-sm">settings</mat-icon> {{ prefs.t('nav.settings') }}
                </a>
              }
              <button (click)="switchUser()" class="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                <mat-icon class="text-sm">swap_horiz</mat-icon>
                {{ prefs.language() === 'bn' ? 'ইউজার পরিবর্তন' : 'Switch user' }}
              </button>
              <button (click)="logout()" class="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer border-t border-slate-100 dark:border-slate-800">
                <mat-icon class="text-sm">logout</mat-icon> {{ prefs.language() === 'bn' ? 'লগআউট' : 'Logout' }}
              </button>
            </div>
          }
        </div>
      </div>
    </header>

    <!-- Calculator Popup -->
    @if (showCalculator()) {
      <app-calculator-modal (close)="showCalculator.set(false)" />
    }

  `
})
export class Header implements OnInit, OnDestroy {
  private static readonly WAREHOUSE_KEY = 'sm_selected_warehouse_v1';
  readonly toggleSidebar = output<void>();
  dataService = inject(DataService);
  private notify = inject(NotificationService);
  session = inject(SessionService);
  prefs = inject(PreferencesService);
  loading = inject(LoadingService);
  private cloud = inject(CloudService);
  private router = inject(Router);

  /** The reason behind the sync chip, so a stuck upload can be inspected without a popup. */
  readonly syncProblem = computed(() => this.cloud.status() === 'error' ? this.cloud.statusMessage() : '');

  /** Server timestamp of the newest row, so the header shows how fresh the shop is. */
  readonly lastUpdateText = computed(() => {
    const at = this.cloud.config().lastRemoteAt;
    if (!at) return '';
    const date = new Date(at);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString(this.locale(), {
      day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
    });
  });

  private now = signal<number>(Date.now());
  private locale = computed(() => this.prefs.language() === 'bn' ? 'bn-BD' : 'en-GB');
  readonly currentTime = computed(() =>
    new Date(this.now()).toLocaleTimeString(this.locale(), { hour: 'numeric', minute: '2-digit', hour12: true })
  );
  readonly currentDate = computed(() =>
    new Date(this.now()).toLocaleDateString(this.locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  );
  showCalculator = signal<boolean>(false);
  selectedWarehouse = signal<string>('SM Warehouse');
  showWarehouseDropdown = signal<boolean>(false);
  showLowStock = signal<boolean>(false);
  readonly stockAlerts = computed(() => this.dataService.lowStockProducts());
  readonly outOfStock = computed(() => this.stockAlerts().filter(p => p.stock <= 0));
  readonly lowStockOnly = computed(() => this.stockAlerts().filter(p => p.stock > 0));
  readonly alertCount = computed(() => this.stockAlerts().length);
  showProfile = signal<boolean>(false);
  warehouseQuery = signal<string>('');
  readonly filteredWarehouses = computed(() => {
    const q = this.warehouseQuery().trim().toLowerCase();
    const list = this.dataService.warehouses();
    return q ? list.filter(w => w.toLowerCase().includes(q)) : list;
  });
  private readonly warehouseSearch = viewChild<ElementRef<HTMLInputElement>>('warehouseSearch');

  private timerId: any;

  ngOnInit() {
    this.updateClock();
    // Warehouses live in the shared catalog; remember which one this device picked.
    const list = this.dataService.warehouses();
    let saved = '';
    try {
      saved = localStorage.getItem(Header.WAREHOUSE_KEY) ?? '';
    } catch {
      /* private mode */
    }
    this.selectedWarehouse.set(list.includes(saved) ? saved : (list[0] ?? 'SM Warehouse'));
    this.timerId = setInterval(() => this.updateClock(), 1000);
  }

  ngOnDestroy() {
    if (this.timerId) clearInterval(this.timerId);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.relative')) {
      this.showLowStock.set(false);
      this.showProfile.set(false);
      this.showWarehouseDropdown.set(false);
      this.warehouseQuery.set('');
    }
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

  private updateClock() {
    this.now.set(Date.now());
  }

  closeMenus() {
    this.showLowStock.set(false);
    this.showProfile.set(false);
    this.showWarehouseDropdown.set(false);
    this.warehouseQuery.set('');
  }

  async openGlobalSearch() {
    const q = await this.notify.prompt('', '', {
      title: this.prefs.txt('সার্বিক খোঁজ', 'Global search'),
      inputLabel: this.prefs.txt('পণ্য, বিক্রয়, কাস্টমার বা সাপ্লায়ার খুঁজুন', 'Search products, sales, customers or suppliers'),
      placeholder: this.prefs.txt('নাম, কোড বা ইনভয়েস নম্বর লিখুন...', 'Type a name, code or invoice number...'),
      confirmText: this.prefs.txt('খুঁজুন', 'Search')
    });
    if (q) {
      this.router.navigate(['/product-manager/products'], { queryParams: { q } });
    }
  }

  toggleWarehouseMenu(event: Event) {
    event.stopPropagation();
    const open = !this.showWarehouseDropdown();
    this.showWarehouseDropdown.set(open);
    this.showLowStock.set(false);
    this.showProfile.set(false);
    this.warehouseQuery.set('');
    if (open) {
      setTimeout(() => this.warehouseSearch()?.nativeElement.focus({ preventScroll: true }));
    }
  }

  onWarehouseQuery(event: Event) {
    this.warehouseQuery.set((event.target as HTMLInputElement).value);
  }

  onWarehouseKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.showWarehouseDropdown.set(false);
      this.warehouseQuery.set('');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const match = this.filteredWarehouses()[0];
      if (match) this.selectWarehouse(match);
    }
  }

  toggleLowStock(event: Event) {
    event.stopPropagation();
    this.showLowStock.update(v => !v);
    this.showProfile.set(false);
    this.showWarehouseDropdown.set(false);
  }

  /** A product's own minimum wins; otherwise the shop-wide default of 5. */
  alertThreshold(p: { minQty?: number }): number {
    return p.minQty && p.minQty > 0 ? p.minQty : 5;
  }

  /** The products page filter that shows exactly this row's alert group. */
  stockAlertMode(p: { stock: number }): 'out' | 'low' {
    return p.stock <= 0 ? 'out' : 'low';
  }

  toggleProfile(event: Event) {
    event.stopPropagation();
    this.showProfile.update(v => !v);
    this.showLowStock.set(false);
    this.showWarehouseDropdown.set(false);
  }

  selectWarehouse(wh: string) {
    this.selectedWarehouse.set(wh);
    this.showWarehouseDropdown.set(false);
    this.warehouseQuery.set('');
    try {
      localStorage.setItem(Header.WAREHOUSE_KEY, wh);
    } catch {
      /* private mode */
    }
  }

  async addWarehouse() {
    const bn = this.prefs.language() === 'bn';
    const name = await this.notify.prompt(
      bn ? 'নতুন ওয়্যারহাউসের নাম দিন।' : 'Enter a name for the new warehouse.',
      '',
      {
        title: bn ? 'নতুন ওয়্যারহাউস' : 'New Warehouse',
        inputLabel: bn ? 'ওয়্যারহাউসের নাম' : 'Warehouse name',
        placeholder: bn ? 'যেমন: শাখা ওয়্যারহাউস' : 'e.g. Branch Warehouse',
        confirmText: bn ? 'যুক্ত করুন' : 'Add',
        cancelText: bn ? 'বাতিল' : 'Cancel'
      }
    );
    const clean = (name ?? '').trim();
    if (!clean) return;
    const list = this.dataService.warehouses().filter(w => typeof w === 'string' && w.trim());
    if (list.some(w => w.toLowerCase() === clean.toLowerCase())) {
      this.notify.error(bn ? `"${clean}" আগে থেকেই আছে।` : `"${clean}" already exists.`);
      return;
    }
    this.dataService.warehouses.set([...list, clean]);
    this.selectWarehouse(clean);
    this.session.log('Warehouse Added', clean);
    this.notify.success(bn ? `"${clean}" ওয়্যারহাউস যুক্ত হয়েছে।` : `"${clean}" added.`);
  }

  switchUser() {
    this.session.logout();
    this.closeMenus();
  }

  async logout() {
    this.closeMenus();
    const confirmed = await this.notify.confirm(this.prefs.txt('চালিয়ে যেতে আবার সাইন ইন করতে হবে।', 'You will need to sign in again to continue.'), {
      title: this.prefs.txt('লগ আউট করবেন?', 'Log out?'),
      kind: 'warning',
      confirmText: this.prefs.txt('লগ আউট', 'Log out')
    });
    if (confirmed) {
      this.session.logout();
    }
  }
}
