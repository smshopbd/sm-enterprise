import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DataService, Product } from '../../services/data';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { DmyDateDirective } from '../../directives/dmy-date.directive';
import { localDateIso } from '../../utils/local-date';
import { WarrantyRegisterRow } from '../../utils/warranty';

interface QuickClaimForm {
  receiveDate: string;
  customerName: string;
  phone: string;
  invoiceNumber: string;
  productId: number | null;
  productName: string;
  serialNumber: string;
  quantity: number;
  unit: string;
  condition: string;
  reason: string;
  keepDefective: boolean;
  giveReplacement: boolean;
  replacementProductId: number | null;
  newSerial: string;
  replacementQty: number;
  source: 'main' | 'warranty';
  notes: string;
}

/**
 * One-screen warranty claim: take the faulty unit, hand over a new one and let
 * the two underlying documents (intake + replacement) settle each other.
 */
@Component({
  selector: 'app-warranty-quick-claim',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, DmyDateDirective],
  template: `
    <div class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4" (click)="cancel()">
      <section class="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[94vh] overflow-y-auto border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200"
        (click)="$event.stopPropagation()">
        <header class="p-4 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-3">
          <div>
            <h2 class="font-bold text-base flex items-center gap-2">
              <mat-icon class="text-teal-600">assignment_return</mat-icon>
              {{ prefs.txt('ফেরত / ওয়ারেন্টি ক্লেইম', 'Return / Warranty Claim') }}
            </h2>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {{ prefs.txt('ত্রুটিপূর্ণ ব্যাটারি গ্রহণ করুন, নতুন ব্যাটারি দিন — এক সেভে দুটোই হবে।', 'Take the faulty battery and hand over a new one — both happen in one save.') }}
            </p>
          </div>
          <button type="button" (click)="cancel()" [disabled]="saving()" class="text-slate-400 hover:text-slate-600 cursor-pointer" [attr.aria-label]="prefs.txt('বন্ধ', 'Close')">
            <mat-icon>close</mat-icon>
          </button>
        </header>

        <form (ngSubmit)="save()" novalidate>
          <fieldset [disabled]="saving()" class="p-4 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label class="block">
                <span class="app-label">{{ prefs.txt('কাস্টমার', 'Customer') }} *</span>
                <input name="customer" [(ngModel)]="form.customerName" required class="app-input" [placeholder]="prefs.txt('কাস্টমারের নাম', 'Customer name')" />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('মোবাইল', 'Mobile') }}</span>
                <input name="phone" [(ngModel)]="form.phone" class="app-input font-mono" placeholder="01712345678" />
              </label>
              <label class="block">
                <span class="app-label">{{ prefs.txt('মূল ইনভয়েস', 'Original Invoice') }}</span>
                <input name="invoice" [(ngModel)]="form.invoiceNumber" class="app-input font-mono" [placeholder]="prefs.txt('বিক্রয় ভাউচার নম্বর', 'Sale voucher number')" />
              </label>
            </div>

            <div class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3 space-y-3">
              <h3 class="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <mat-icon class="text-sm">battery_alert</mat-icon> {{ prefs.txt('ত্রুটিপূর্ণ ব্যাটারি (গ্রাহকের কাছ থেকে)', 'Faulty battery (from customer)') }}
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="block sm:col-span-2">
                  <span class="app-label">{{ prefs.txt('পণ্য / মডেল', 'Product / Model') }} *</span>
                  <input name="productName" [(ngModel)]="form.productName" (ngModelChange)="onOldProductName($event)" required class="app-input" [placeholder]="prefs.txt('ব্যাটারির নাম বা মডেল', 'Battery name or model')" />
                </label>
                <label class="block">
                  <span class="app-label">{{ prefs.txt('সিরিয়াল', 'Serial') }}</span>
                  <input name="serial" [(ngModel)]="form.serialNumber" class="app-input font-mono" [placeholder]="prefs.txt('পুরনো সিরিয়াল', 'Old serial')" />
                </label>
                <label class="block">
                  <span class="app-label">{{ prefs.txt('পরিমাণ', 'Quantity') }} *</span>
                  <div class="flex">
                    <input name="qty" type="number" min="0.01" step="any" [(ngModel)]="form.quantity" class="app-input rounded-r-none" />
                    <span class="inline-flex items-center rounded-r-lg border border-l-0 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2 font-bold text-slate-500">{{ form.unit || 'pcs' }}</span>
                  </div>
                </label>
                <label class="block">
                  <span class="app-label">{{ prefs.txt('অবস্থা', 'Condition') }}</span>
                  <select name="condition" [(ngModel)]="form.condition" class="app-input">
                    @for (condition of settings().conditions; track condition) { <option [ngValue]="condition">{{ condition }}</option> }
                  </select>
                </label>
                <label class="block">
                  <span class="app-label">{{ prefs.txt('গ্রহণের তারিখ', 'Received On') }} *</span>
                  <input name="receiveDate" type="date" appDmyDate [(ngModel)]="form.receiveDate" class="app-input" required />
                </label>
                <label class="block sm:col-span-3">
                  <span class="app-label">{{ prefs.txt('সমস্যা / নোট', 'Fault / Note') }}</span>
                  <input name="reason" [(ngModel)]="form.reason" class="app-input" [placeholder]="prefs.txt('যেমন: চার্জ নেয় না', 'e.g. does not charge')" />
                </label>
              </div>
              <label class="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                <input name="keepDefective" type="checkbox" [(ngModel)]="form.keepDefective" class="h-4 w-4 accent-teal-600" />
                {{ prefs.txt('ত্রুটিপূর্ণ ব্যাটারি ওয়ারেন্টি স্টকে জমা রাখুন', 'Keep the faulty battery in warranty stock') }}
              </label>
            </div>

            <div class="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-950/30 p-3 space-y-3">
              <label class="flex items-center gap-2 font-bold text-teal-800 dark:text-teal-300">
                <input name="giveReplacement" type="checkbox" [(ngModel)]="form.giveReplacement" class="h-4 w-4 accent-teal-600" />
                {{ prefs.txt('গ্রাহককে নতুন ব্যাটারি দিচ্ছি', 'Handing over a new battery now') }}
              </label>

              @if (form.giveReplacement) {
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label class="block sm:col-span-2">
                    <span class="app-label">{{ prefs.txt('নতুন ব্যাটারি', 'New Battery') }} *</span>
                    <select name="replacementProduct" [ngModel]="form.replacementProductId" (ngModelChange)="onReplacementProduct($event)" class="app-input" required>
                      <option [ngValue]="null">{{ prefs.txt('— পণ্য বাছুন —', '— Select product —') }}</option>
                      @for (product of products(); track product.id) {
                        <option [ngValue]="product.id">{{ product.name }} · {{ product.code }} · {{ product.unit }}</option>
                      }
                    </select>
                  </label>
                  <label class="block">
                    <span class="app-label">{{ prefs.txt('নতুন সিরিয়াল', 'New Serial') }}</span>
                    <input name="newSerial" [(ngModel)]="form.newSerial" class="app-input font-mono" [placeholder]="prefs.txt('ঐচ্ছিক', 'Optional')" />
                  </label>
                  <label class="block">
                    <span class="app-label">{{ prefs.txt('পরিমাণ', 'Quantity') }} *</span>
                    <input name="replacementQty" type="number" min="0.01" step="any" [(ngModel)]="form.replacementQty" class="app-input" />
                  </label>
                  <label class="block sm:col-span-2">
                    <span class="app-label">{{ prefs.txt('স্টক কোথা থেকে', 'Stock Source') }}</span>
                    <select name="source" [(ngModel)]="form.source" class="app-input">
                      <option value="main" [disabled]="!settings().allowMainStockReplacement">{{ prefs.txt('মূল বিক্রয় স্টক', 'Main sales stock') }}</option>
                      <option value="warranty">{{ prefs.txt('ওয়ারেন্টি রিপ্লেসমেন্ট স্টক', 'Warranty replacement stock') }}</option>
                    </select>
                  </label>
                  @if (replacementProduct(); as product) {
                    <p class="sm:col-span-3 text-[11px] font-semibold" [class]="stockShort() ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'">
                      {{ prefs.txt('মূল স্টকে আছে', 'Main stock') }}: <b>{{ product.stock | number:'1.0-2' }} {{ product.unit }}</b>
                      · {{ prefs.txt('ওয়ারেন্টি স্টকে আছে', 'Warranty stock') }}: <b>{{ warrantyStock() | number:'1.0-2' }} {{ product.unit }}</b>
                      @if (stockShort()) { <span class="block">{{ prefs.txt('এই সোর্সে পর্যাপ্ত স্টক নেই — সোর্স বদলান বা স্টক বাড়ান।', 'Not enough stock in this source — change the source or add stock.') }}</span> }
                    </p>
                  }
                </div>
              } @else {
                <p class="text-[11px] text-teal-800 dark:text-teal-300">
                  {{ prefs.txt('শুধু গ্রহণ সংরক্ষণ হবে। পরে ওয়ারেন্টি → পরিবর্তন পেজ থেকে নতুন ব্যাটারি দিতে পারবেন।', 'Only the intake will be saved. You can hand over the battery later from Warranty → Replacement.') }}
                </p>
              }
            </div>

            <label class="block">
              <span class="app-label">{{ prefs.txt('নোট', 'Note') }}</span>
              <textarea name="notes" rows="2" [(ngModel)]="form.notes" class="app-input resize-y" [placeholder]="prefs.txt('ঐচ্ছিক মন্তব্য', 'Optional remark')"></textarea>
            </label>

            @if (error()) {
              <p role="alert" class="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-3 py-2 font-semibold text-rose-700 dark:text-rose-300">{{ error() }}</p>
            }
          </fieldset>

          <footer class="p-4 pt-0 flex flex-wrap justify-end gap-2">
            <button type="button" (click)="cancel()" [disabled]="saving()" class="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 font-bold cursor-pointer">{{ prefs.txt('বাতিল', 'Cancel') }}</button>
            <button type="submit" [disabled]="saving()" class="rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-4 py-2 font-bold cursor-pointer flex items-center gap-1">
              <mat-icon class="text-sm">save</mat-icon>
              {{ saving() ? prefs.txt('সংরক্ষণ হচ্ছে…', 'Saving…') : prefs.txt('ক্লেইম সংরক্ষণ করুন', 'Save Claim') }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  `,
  styles: [`
    .app-label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: #64748b; margin-bottom: 3px; }
    .app-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 7px 9px; font-size: 12px; color: #0f172a; outline: none; }
    .app-input:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13,148,136,.15); }
    :host-context(.dark) .app-label { color: #94a3b8; }
    :host-context(.dark) .app-input { background: #0b1220; border-color: #475569; color: #e2e8f0; }
  `]
})
export class WarrantyQuickClaim implements OnInit {
  private readonly data = inject(DataService);
  private readonly session = inject(SessionService);
  private readonly notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);
  readonly settings = this.data.warrantySettings;

  readonly row = input<WarrantyRegisterRow | null>(null);
  readonly close = output<void>();
  readonly saved = output<void>();

  readonly saving = signal(false);
  readonly error = signal('');
  form: QuickClaimForm = this.emptyForm();

  readonly products = () => this.data.products()
    .filter(product => product.type !== 'service')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  ngOnInit() {
    const row = this.row();
    if (!row) return;
    const product = this.matchProduct(row.productName);
    this.form = {
      ...this.emptyForm(),
      customerName: row.customerName || '',
      phone: row.phoneNumber || '',
      invoiceNumber: row.invoiceNumber || '',
      productId: product?.id ?? null,
      productName: row.productName || '',
      serialNumber: row.serialNumber || '',
      quantity: Number(row.quantity) || 1,
      unit: row.unit || product?.unit || 'pcs',
      replacementProductId: product?.id ?? null
    };
  }

  replacementProduct(): Product | undefined {
    return this.products().find(product => product.id === this.form.replacementProductId);
  }

  warrantyStock(): number {
    const product = this.replacementProduct();
    if (!product) return 0;
    return this.data.warrantyStockOf(product.id, product.name, product.unit).replacement;
  }

  stockShort(): boolean {
    const product = this.replacementProduct();
    if (!product || !this.form.giveReplacement) return false;
    const qty = Number(this.form.replacementQty) || 0;
    if (this.settings().allowNegativeStock) return false;
    if (this.form.source === 'main') return (Number(product.stock) || 0) < qty;
    return this.warrantyStock() < qty;
  }

  onOldProductName(name: string) {
    this.form.productName = name || '';
    const product = this.matchProduct(name);
    this.form.productId = product?.id ?? null;
    if (product?.unit) this.form.unit = product.unit;
  }

  onReplacementProduct(productId: number | null) {
    this.form.replacementProductId = productId;
    this.error.set('');
  }

  cancel() {
    if (!this.saving()) this.close.emit();
  }

  save() {
    if (this.saving()) return;
    const form = this.form;
    const error = this.validate();
    if (error) { this.error.set(error); return; }

    const replacementProduct = this.replacementProduct();
    this.saving.set(true);
    this.error.set('');
    try {
      const receipt = this.data.recordWarrantyReceipt({
        date: form.receiveDate || localDateIso(),
        customerName: form.customerName.trim(),
        phone: (form.phone || '').trim(),
        invoiceNumber: (form.invoiceNumber || '').trim(),
        saleId: this.row()?.saleId,
        productId: form.productId ?? undefined,
        productName: form.productName.trim(),
        serialNumber: (form.serialNumber || '').trim(),
        quantity: Number(form.quantity) || 1,
        unit: form.unit || 'pcs',
        warrantyStart: this.row()?.date || '',
        warrantyDays: this.row()?.warrantyDays,
        condition: form.condition || '',
        reason: (form.reason || '').trim(),
        status: this.settings().receiptStatuses[0] || '',
        stockIn: form.keepDefective,
        notes: (form.notes || '').trim(),
        handledBy: this.session.currentUser()?.name || ''
      });

      if (form.giveReplacement && replacementProduct) {
        const result = this.data.recordWarrantyReplacement({
          date: form.receiveDate || localDateIso(),
          receiptId: receipt.id,
          customerName: form.customerName.trim(),
          phone: (form.phone || '').trim(),
          productId: replacementProduct.id,
          productName: replacementProduct.name,
          serialNumber: (form.newSerial || '').trim(),
          quantity: Number(form.replacementQty) || 1,
          unit: replacementProduct.unit,
          source: form.source,
          stockInQty: 0,
          disposeReceived: false,
          disposition: '',
          cost: 0,
          stage: 'completed',
          status: this.settings().replacementStatuses[0] || '',
          notes: (form.notes || '').trim(),
          handledBy: this.session.currentUser()?.name || ''
        });
        if (!result.ok) {
          this.data.deleteWarrantyReceipt(receipt.id);
          this.error.set(result.error === 'main-shortage' || result.error === 'shortage'
            ? this.prefs.txt('নির্বাচিত সোর্সে পর্যাপ্ত স্টক নেই।', 'Not enough stock in the selected source.')
            : this.prefs.txt('নতুন ব্যাটারির তথ্য যাচাই করুন; ক্লেইম সংরক্ষণ হয়নি।', 'Check the replacement details; the claim was not saved.'));
          return;
        }
      }

      this.notify.success(
        this.prefs.txt(
          `ক্লেইম ${receipt.claimNo} সংরক্ষিত — ত্রুটিপূর্ণ ${form.productName} ${form.keepDefective ? 'স্টকে জমা হয়েছে' : 'গ্রহণ করা হয়েছে'}${form.giveReplacement && replacementProduct ? `, নতুন ${replacementProduct.name} দেওয়া হয়েছে` : ''}।`,
          `Claim ${receipt.claimNo} saved — faulty ${form.productName} ${form.keepDefective ? 'is in warranty stock' : 'was received'}${form.giveReplacement && replacementProduct ? `, new ${replacementProduct.name} issued` : ''}.`
        ),
        this.prefs.txt('ওয়ারেন্টি ক্লেইম', 'Warranty Claim')
      );
      this.saved.emit();
      this.close.emit();
    } catch {
      this.error.set(this.prefs.txt('ক্লেইম সংরক্ষণ নিশ্চিত করা যায়নি। তালিকা দেখে আবার চেষ্টা করুন।', 'Could not confirm the claim. Check the list before retrying.'));
    } finally {
      this.saving.set(false);
    }
  }

  private validate(): string {
    const form = this.form;
    if (!form.customerName.trim()) return this.prefs.txt('কাস্টমারের নাম দিন।', 'Enter the customer name.');
    if (!form.productName.trim()) return this.prefs.txt('ত্রুটিপূর্ণ ব্যাটারির নাম দিন।', 'Enter the faulty battery name.');
    if (!(Number(form.quantity) > 0)) return this.prefs.txt('সঠিক পরিমাণ দিন।', 'Enter a valid quantity.');
    if (!form.receiveDate) return this.prefs.txt('গ্রহণের তারিখ দিন।', 'Enter the received date.');
    if (!form.giveReplacement) return '';
    const product = this.replacementProduct();
    if (!product) return this.prefs.txt('নতুন ব্যাটারি বেছে নিন।', 'Select the new battery.');
    if (!(Number(form.replacementQty) > 0)) return this.prefs.txt('নতুন ব্যাটারির পরিমাণ দিন।', 'Enter the replacement quantity.');
    if (form.source === 'main' && !this.settings().allowMainStockReplacement) {
      return this.prefs.txt('মূল স্টক থেকে পরিবর্তন সেটিংসে বন্ধ আছে; ওয়ারেন্টি স্টক বেছে নিন।', 'Main-stock replacement is disabled in settings; choose warranty stock.');
    }
    if (this.stockShort()) return this.prefs.txt('নির্বাচিত সোর্সে পর্যাপ্ত স্টক নেই।', 'Not enough stock in the selected source.');
    return '';
  }

  private matchProduct(name: string | null | undefined): Product | undefined {
    const key = (name || '').trim().toLowerCase();
    if (!key) return undefined;
    return this.data.products().find(product => product.name.trim().toLowerCase() === key);
  }

  private emptyForm(): QuickClaimForm {
    return {
      receiveDate: localDateIso(),
      customerName: '',
      phone: '',
      invoiceNumber: '',
      productId: null,
      productName: '',
      serialNumber: '',
      quantity: 1,
      unit: 'pcs',
      condition: '',
      reason: '',
      keepDefective: true,
      giveReplacement: true,
      replacementProductId: null,
      newSerial: '',
      replacementQty: 1,
      source: 'warranty',
      notes: ''
    };
  }
}
