import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DataService, WarrantyReceipt, WarrantyReplacement } from '../../services/data';
import { PreferencesService } from '../../services/preferences';
import { NotificationService } from '../../services/notification';
import { dmyFromIso } from '../../utils/local-date';
import { qrDataUrl } from '../../utils/qr-code';
import { warrantyExpiryDate } from '../../utils/warranty';

/**
 * Printable claim slip for both documents: the intake receipt the customer keeps
 * when a product is handed in, and the replacement slip handed over on exchange.
 */
@Component({
  selector: 'app-warranty-claim',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  styles: [`
    .wc-sheet { position: relative; max-width: 760px; margin: 0 auto; background: #fff; color: #17252c; padding: 22px 26px 18px; box-sizing: border-box;
      font: 12px/1.45 Calibri, 'Kalpurush', sans-serif; border: 1px solid #cbd5d5; border-radius: 8px; overflow: hidden; }
    .wc-sheet * { box-sizing: border-box; }
    .wc-strip { position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, var(--wc-accent, #087d6c), #22b8a6); }
    .wc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid var(--wc-accent, #087d6c); padding: 5px 0 10px; }
    .wc-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    /* The shop artwork is a wide letterhead; crop the emblem the same way the sales vouchers do. */
    .wc-logo { position: relative; overflow: hidden; width: 64px; height: 53px; flex: 0 0 64px; }
    .wc-logo img { position: absolute; width: 430.08px; max-width: none; left: -36.4px; top: -25.2px; }
    .wc-brand h1 { margin: 0; font-size: 20px; line-height: 1.15; color: var(--wc-accent, #087d6c); font-weight: 700; }
    .wc-brand p { margin: 1px 0 0; font-size: 10.5px; color: #596770; }
    .wc-head-side { display: flex; align-items: flex-start; gap: 14px; flex: 0 0 auto; }
    .wc-meta { text-align: right; font-size: 11px; color: #334155; padding-top: 2px; }
    .wc-meta .wc-no { display: block; font: 700 15px/1.25 ui-monospace, monospace; color: #0f172a; letter-spacing: .02em; }
    .wc-meta .wc-date { color: #596770; }
    .wc-status { display: inline-flex; align-items: center; gap: 4px; margin-top: 5px; padding: 2px 9px; border-radius: 999px; font-size: 10px; font-weight: 700;
      color: var(--wc-accent, #087d6c); background: color-mix(in srgb, var(--wc-accent, #087d6c) 12%, #fff); border: 1px solid color-mix(in srgb, var(--wc-accent, #087d6c) 35%, #fff); }
    .wc-qr { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 4px 4px 3px; border: 1px solid #cbd5d5; border-radius: 6px; background: #fff; }
    .wc-qr img { display: block; }
    .wc-qr span { font-size: 8px; line-height: 1.2; letter-spacing: .02em; color: #596770; text-align: center; max-width: 96px; }
    .wc-title { display: flex; align-items: center; gap: 10px; margin: 12px 0 8px; }
    .wc-title::before, .wc-title::after { content: ''; flex: 1; height: 1px; }
    .wc-title::before { background: linear-gradient(90deg, transparent, #cbd5d5); }
    .wc-title::after { background: linear-gradient(270deg, transparent, #cbd5d5); }
    .wc-title span { background: var(--wc-accent, #087d6c); color: #fff; font-weight: 700; font-size: 12.5px; padding: 4px 16px; border-radius: 999px; letter-spacing: .03em; }
    .wc-notice { margin: 0 0 8px; padding: 6px 10px; border: 1px dashed #d97706; border-radius: 5px; background: #fffbeb; color: #92400e; font-size: 10.5px; font-weight: 700; }
    .wc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; border-top: 1px solid #cbd5d5; }
    .wc-section { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; margin: 8px 0 2px; font-size: 9.5px; font-weight: 700;
      letter-spacing: .12em; text-transform: uppercase; color: var(--wc-accent, #087d6c); }
    .wc-section::after { content: ''; flex: 1; height: 1px; background: #dbe4e3; }
    .wc-row { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dashed #dbe4e3; padding: 5px 0; min-width: 0; }
    .wc-row dt { color: #596770; font-size: 10.5px; flex: 0 0 auto; }
    .wc-row dd { margin: 0; font-weight: 700; text-align: right; overflow-wrap: anywhere; }
    .wc-full { grid-column: 1 / -1; }
    .wc-block { border: 1px solid #cbd5d5; border-left: 3px solid var(--wc-accent, #087d6c); border-radius: 5px; padding: 6px 10px; margin-top: 10px; }
    .wc-block h2 { margin: 0 0 4px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #596770; }
    .wc-block p { margin: 0; white-space: pre-line; }
    .wc-terms { margin-top: 10px; padding: 7px 10px; border-radius: 5px; background: #f5f8f8; font-size: 10px; color: #596770; white-space: pre-line; }
    .wc-sign { display: flex; justify-content: space-between; gap: 30px; margin-top: 32px; font-size: 10.5px; }
    .wc-sign span { border-top: 1px solid #849295; padding: 5px 26px 0; text-align: center; color: #334155; }
    .wc-foot { margin-top: 12px; border-top: 1px solid #cbd5d5; padding-top: 5px; text-align: center; font-size: 10px; color: #596770; }
    @media print {
      .wc-sheet { max-width: none; border: none; border-radius: 0; padding: 0; print-color-adjust: exact; }
      .wc-row, .wc-block, .wc-sign { break-inside: avoid; }
    }
  `],
  template: `
    @if (receipt(); as r) {
      <div class="wc-shell fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs overflow-y-auto p-4">
        <div class="max-w-3xl mx-auto">
          <div class="no-print flex items-center justify-end gap-2 mb-3">
            <button (click)="print()" class="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-xs cursor-pointer text-xs">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="close.emit()" class="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-xs cursor-pointer text-xs">
              <mat-icon class="text-sm">close</mat-icon> {{ prefs.txt('বন্ধ', 'Close') }}
            </button>
          </div>

          <div id="printable-area" class="wc-sheet" [style.--wc-accent]="shop().accentColor || '#087d6c'">
            <div class="wc-strip"></div>
            <div class="wc-head">
              <div class="wc-brand">
                @if (shop().showLogo) {
                  <div class="wc-logo"><img src="assets/sm-logo.jpg" alt="logo" /></div>
                }
                <div>
                  <h1>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }}</h1>
                  <p>{{ shop().address }}</p>
                  <p>{{ shop().mobile }}</p>
                </div>
              </div>
              <div class="wc-head-side">
                <div class="wc-meta">
                  <strong class="wc-no">{{ r.claimNo }}</strong>
                  <div class="wc-date">{{ prefs.txt('তারিখ', 'Date') }}: {{ dateText(r.date) }}</div>
                  <span class="wc-status">{{ r.status }}</span>
                </div>
                @if (showQr()) {
                  <div class="wc-qr">
                    <img [src]="receiptQr()" [style.width.px]="qrPx()" [style.height.px]="qrPx()" alt="QR Code" />
                    <span>{{ prefs.txt('স্ক্যান করে যাচাই করুন', 'Scan to verify') }}</span>
                  </div>
                }
              </div>
            </div>

            <div class="wc-title"><span>{{ settings().printTitle || prefs.txt('ওয়ারেন্টি ক্লেইম রিসিট', 'Warranty Claim Receipt') }}</span></div>

            <dl class="wc-grid">
              <div class="wc-section">{{ prefs.txt('কাস্টমার তথ্য', 'Customer Details') }}</div>
              <div class="wc-row"><dt>{{ prefs.txt('কাস্টমার', 'Customer') }}</dt><dd>{{ r.customerName || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('মোবাইল', 'Mobile') }}</dt><dd>{{ r.phone || '-' }}</dd></div>
              <div class="wc-row wc-full"><dt>{{ prefs.txt('ঠিকানা', 'Address') }}</dt><dd>{{ r.address || '-' }}</dd></div>

              <div class="wc-section">{{ prefs.txt('পণ্য ও ওয়ারেন্টি', 'Product & Warranty') }}</div>
              <div class="wc-row"><dt>{{ prefs.txt('পণ্য', 'Product') }}</dt><dd>{{ r.productName }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('সিরিয়াল', 'Serial') }}</dt><dd>{{ r.serialNumber || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('পরিমাণ', 'Quantity') }}</dt><dd>{{ qtyText(r.quantity, r.unit) }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('অবস্থা/কন্ডিশন', 'Condition') }}</dt><dd>{{ r.condition || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('মূল ইনভয়েস', 'Invoice') }}</dt><dd>{{ r.invoiceNumber || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('ওয়ারেন্টি মেয়াদ', 'Warranty') }}</dt><dd>{{ r.warrantyDays ? r.warrantyDays + ' ' + prefs.txt('দিন', 'days') : '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('মেয়াদ শেষ', 'Expires') }}</dt><dd>{{ dateText(expiryOf(r)) || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('সম্ভাব্য ডেলিভারি', 'Expected') }}</dt><dd>{{ dateText(r.expectedDate || '') || '-' }}</dd></div>
            </dl>

            @if (r.reason) {
              <div class="wc-block">
                <h2>{{ prefs.txt('সমস্যার বিবরণ', 'Reported Fault') }}</h2>
                <p>{{ r.reason }}</p>
              </div>
            }
            @if (r.accessories) {
              <div class="wc-block">
                <h2>{{ prefs.txt('জমা দেওয়া এক্সেসরিজ', 'Accessories Received') }}</h2>
                <p>{{ r.accessories }}</p>
              </div>
            }

            <p class="wc-terms">{{ settings().printTerms }}</p>

            <div class="wc-sign">
              <span>{{ prefs.txt('কাস্টমারের স্বাক্ষর', 'Customer Signature') }}</span>
              <span>{{ prefs.txt('গ্রহণকারী', 'Received By') }}: {{ r.handledBy || '' }}</span>
            </div>
            <p class="wc-foot">{{ settings().printFooter }}</p>
          </div>
        </div>
      </div>
    }

    @if (replacement(); as x) {
      <div class="wc-shell fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs overflow-y-auto p-4">
        <div class="max-w-3xl mx-auto">
          <div class="no-print flex items-center justify-end gap-2 mb-3">
            <button (click)="print()" class="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-xs cursor-pointer text-xs">
              <mat-icon class="text-sm">print</mat-icon> {{ prefs.txt('প্রিন্ট', 'Print') }}
            </button>
            <button (click)="close.emit()" class="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-xs cursor-pointer text-xs">
              <mat-icon class="text-sm">close</mat-icon> {{ prefs.txt('বন্ধ', 'Close') }}
            </button>
          </div>

          <div id="printable-area" class="wc-sheet" [style.--wc-accent]="shop().accentColor || '#087d6c'">
            <div class="wc-strip"></div>
            <div class="wc-head">
              <div class="wc-brand">
                @if (shop().showLogo) {
                  <div class="wc-logo"><img src="assets/sm-logo.jpg" alt="logo" /></div>
                }
                <div>
                  <h1>{{ shop().businessNamePart1 }} {{ shop().businessNamePart2 }}</h1>
                  <p>{{ shop().address }}</p>
                  <p>{{ shop().mobile }}</p>
                </div>
              </div>
              <div class="wc-head-side">
                <div class="wc-meta">
                  <strong class="wc-no">{{ x.claimNo }}</strong>
                  <div class="wc-date">{{ prefs.txt('তারিখ', 'Date') }}: {{ dateText(x.date) }}</div>
                  <span class="wc-status">{{ x.status }}</span>
                </div>
                @if (showQr()) {
                  <div class="wc-qr">
                    <img [src]="replacementQr()" [style.width.px]="qrPx()" [style.height.px]="qrPx()" alt="QR Code" />
                    <span>{{ prefs.txt('স্ক্যান করে যাচাই করুন', 'Scan to verify') }}</span>
                  </div>
                }
              </div>
            </div>

            <div class="wc-title"><span>{{ prefs.txt('ওয়ারেন্টি পরিবর্তন রিসিট', 'Warranty Replacement Receipt') }}</span></div>
            @if (x.stage !== 'completed') {
              <p class="wc-notice">{{ prefs.txt('পণ্য ইস্যু হয়নি; এই ডকুমেন্টে কোনো স্টক চলাচল হয়নি।', 'No goods issued; this document has not posted any stock movements.') }}</p>
            }

            <dl class="wc-grid">
              <div class="wc-section">{{ prefs.txt('কাস্টমার তথ্য', 'Customer Details') }}</div>
              <div class="wc-row"><dt>{{ prefs.txt('কাস্টমার', 'Customer') }}</dt><dd>{{ x.customerName || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('মোবাইল', 'Mobile') }}</dt><dd>{{ x.phone || '-' }}</dd></div>

              <div class="wc-section">{{ prefs.txt('পরিবর্তনের বিবরণ', 'Replacement Details') }}</div>
              <div class="wc-row"><dt>{{ prefs.txt('গ্রহণ ক্লেইম', 'Intake Claim') }}</dt><dd>{{ x.receiptClaimNo || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('কার্যকরী ধাপ', 'Stage') }}</dt><dd>{{ x.stage === 'completed' ? prefs.txt('সম্পন্ন', 'Completed') : x.stage === 'pending' ? prefs.txt('অপেক্ষমাণ', 'Pending') : prefs.txt('বাতিল', 'Cancelled') }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('নতুন পণ্য', 'Replacement') }}</dt><dd>{{ x.productName }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('নতুন সিরিয়াল', 'New Serial') }}</dt><dd>{{ x.serialNumber || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('পরিমাণ', 'Quantity') }}</dt><dd>{{ qtyText(x.quantity, x.unit) }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('স্টক সোর্স', 'Stock Source') }}</dt><dd>{{ x.source === 'main' ? prefs.txt('মূল স্টক', 'Main Stock') : prefs.txt('ওয়ারেন্টি স্টক', 'Warranty Stock') }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('সরবরাহকারী', 'Supplier') }}</dt><dd>{{ x.supplierName || '-' }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('সরবরাহকারী রেফ', 'Supplier Ref') }}</dt><dd>{{ x.supplierRef || '-' }}</dd></div>
              <div class="wc-row wc-full"><dt>{{ prefs.txt('পুরাতন ইউনিট', 'Old Unit') }}</dt><dd>{{ x.stage === 'completed' && x.disposeReceived ? (x.disposition || prefs.txt('গ্রহণ স্টক থেকে বাদ দেওয়ার নির্দেশ', 'Remove from intake stock')) : prefs.txt('গ্রহণ স্টক থেকে বাদ দেওয়া হয়নি', 'No intake removal posted') }}</dd></div>
              <div class="wc-row"><dt>{{ prefs.txt('খরচ', 'Cost') }}</dt><dd>{{ x.cost ? ('৳ ' + x.cost) : '-' }}</dd></div>
            </dl>

            @if (x.notes) {
              <div class="wc-block">
                <h2>{{ prefs.txt('নোট', 'Notes') }}</h2>
                <p>{{ x.notes }}</p>
              </div>
            }

            <p class="wc-terms">{{ settings().printTerms }}</p>

            <div class="wc-sign">
              <span>{{ prefs.txt('কাস্টমারের স্বাক্ষর', 'Customer Signature') }}</span>
              <span>{{ prefs.txt('প্রদানকারী', 'Issued By') }}: {{ x.handledBy || '' }}</span>
            </div>
            <p class="wc-foot">{{ settings().printFooter }}</p>
          </div>
        </div>
      </div>
    }
  `
})
export class WarrantyClaim {
  private dataService = inject(DataService);
  private host: ElementRef<HTMLElement> = inject(ElementRef);
  private notify = inject(NotificationService);
  readonly prefs = inject(PreferencesService);

  receipt = input<WarrantyReceipt | null>(null);
  replacement = input<WarrantyReplacement | null>(null);
  close = output<void>();

  readonly settings = this.dataService.warrantySettings;
  private readonly voucher = this.dataService.voucherSettings;

  shop(): ReturnType<DataService['voucherSettings']> {
    return this.voucher();
  }

  readonly showQr = computed(() => this.voucher().showQRCode);

  /** Claim payload is denser than a short share link, so keep the code above 104px. */
  readonly qrPx = computed(() => Math.min(150, Math.max(104, Number(this.voucher().qrSize) || 75)));

  readonly receiptQr = computed(() => {
    const r = this.receipt();
    if (!r || !this.showQr()) return '';
    return qrDataUrl(this.receiptPayload(r), 360);
  });

  readonly replacementQr = computed(() => {
    const x = this.replacement();
    if (!x || !this.showQr()) return '';
    return qrDataUrl(this.replacementPayload(x), 360);
  });

  /** Compact plain text: any phone camera shows the claim without opening the app. */
  private receiptPayload(r: WarrantyReceipt): string {
    const contact = [r.customerName, r.phone].filter(Boolean).join(' | ');
    const item = [r.productName, r.serialNumber ? `SN: ${r.serialNumber}` : ''].filter(Boolean).join(' | ');
    const qty = `Qty: ${r.quantity} ${r.unit}`.trim();
    return [
      `RECEIPT ${r.claimNo} | ${r.date}`,
      contact,
      item,
      r.status ? `${qty} | Status: ${r.status}` : qty
    ].filter(Boolean).join('\n');
  }

  private replacementPayload(x: WarrantyReplacement): string {
    const contact = [x.customerName, x.phone].filter(Boolean).join(' | ');
    const item = [x.productName, x.serialNumber ? `SN: ${x.serialNumber}` : ''].filter(Boolean).join(' | ');
    const source = x.source === 'main' ? 'Main Stock' : 'Warranty Stock';
    const qty = `Qty: ${x.quantity} ${x.unit}`.trim();
    return [
      `REPLACEMENT ${x.claimNo} | ${x.date}`,
      [x.receiptClaimNo ? `Intake: ${x.receiptClaimNo}` : '', `Stage: ${x.stage}`].filter(Boolean).join(' | '),
      contact,
      item,
      `${qty} | Source: ${source}`
    ].filter(Boolean).join('\n');
  }

  dateText(iso: string): string {
    return dmyFromIso(iso);
  }

  expiryOf(row: WarrantyReceipt): string {
    return row.warrantyStart && row.warrantyDays ? warrantyExpiryDate(row.warrantyStart, row.warrantyDays) : '';
  }

  qtyText(quantity: number, unit: string): string {
    const value = Number(quantity) || 0;
    return `${value} ${unit || ''}`.trim();
  }

  async print(): Promise<void> {
    const sheet = this.host.nativeElement.querySelector<HTMLElement>('#printable-area');
    if (!sheet) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:794px;height:1123px;border:0;background:#fff;';
    document.body.appendChild(frame);
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) throw new Error('Print frame could not be created.');
      doc.open();
      doc.write('<!doctype html><html lang="bn"><head><meta charset="utf-8"></head><body></body></html>');
      doc.close();
      doc.title = `${this.prefs.txt('ওয়ারেন্টি রিসিট', 'Warranty Receipt')} ${this.receipt()?.claimNo || this.replacement()?.claimNo || ''}`;
      for (const source of document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')) {
        const style = source.cloneNode(true) as HTMLElement;
        if (style instanceof HTMLLinkElement && new URL(style.href).origin !== location.origin) continue;
        doc.head.appendChild(style);
      }
      const pageStyle = doc.createElement('style');
      pageStyle.textContent = '@page { size:A4; margin:9mm 12mm; } html,body { margin:0; padding:0; background:#fff; } .wc-sheet { max-width:none; border:0; border-radius:0; padding:0; print-color-adjust:exact; } .wc-row,.wc-block,.wc-sign { break-inside:avoid; }';
      doc.head.appendChild(pageStyle);
      const clone = sheet.cloneNode(true) as HTMLElement;
      clone.style.cssText = 'position:static;width:100%;max-width:none;margin:0;padding:0;border:0;border-radius:0;background:#fff;color:#17252c;';
      for (const image of Array.from(clone.querySelectorAll('img'))) {
        const original = Array.from(sheet.querySelectorAll('img')).find(img => img.getAttribute('src') === image.getAttribute('src'));
        if (original?.naturalWidth) {
          const canvas = doc.createElement('canvas');
          canvas.width = original.naturalWidth;
          canvas.height = original.naturalHeight;
          canvas.getContext('2d')?.drawImage(original, 0, 0);
          image.src = canvas.toDataURL('image/png');
        } else {
          image.src = new URL(image.getAttribute('src') || '', document.baseURI).href;
        }
      }
      doc.body.appendChild(clone);
      await Promise.all([
        Promise.race([doc.fonts.ready, new Promise(resolve => setTimeout(resolve, 4000))]),
        ...Array.from(doc.images).map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => {
          image.onload = () => resolve();
          image.onerror = () => resolve();
          setTimeout(resolve, 4000);
        }))
      ]);
      const cleanup = () => { win.removeEventListener('afterprint', cleanup); frame.remove(); };
      win.addEventListener('afterprint', cleanup);
      setTimeout(cleanup, 90000);
      win.focus();
      win.print();
    } catch {
      frame.remove();
      this.notify.error(this.prefs.txt('প্রিন্ট করা যায়নি। আবার চেষ্টা করুন।', 'Print failed. Please try again.'));
    }
  }
}
