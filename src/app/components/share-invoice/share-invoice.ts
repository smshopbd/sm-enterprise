import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { NotificationService } from '../../services/notification';
import { PreferencesService } from '../../services/preferences';
import {
  buildJpegPdfFromPages,
  captureInvoiceJpeg,
  openWhatsApp,
  shareInvoiceFile,
  stitchJpegsVertically,
} from '../../utils/share-invoice';
import { dataUrlToBlob, saveBlob } from '../../utils/voucher-print';

type ShareAction = 'pdf' | 'image';

/** Phones and small tablets only — desktop layouts get no share UI at all. */
const PHONE_LAYOUT = '(max-width: 1023px)';

@Component({
  selector: 'app-share-invoice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'inline-flex' },
  template: `
    @if (phone()) {
      <button
        type="button"
        [disabled]="!!busy()"
        (click)="toggle($event)"
        [title]="prefs.txt('ইনভয়েস শেয়ার করুন', 'Share invoice')"
        [attr.aria-label]="prefs.txt('ইনভয়েস শেয়ার করুন', 'Share invoice')"
        [class]="iconOnly()
          ? 'p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 cursor-pointer'
          : 'bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-2xs disabled:opacity-60 cursor-pointer'"
      >
        <mat-icon [class]="iconOnly() ? 'text-sm' : 'text-xs'">share</mat-icon>
        @if (!iconOnly()) {
          <span>{{ prefs.txt('শেয়ার', 'Share') }}</span>
        }
      </button>

      @if (open()) {
        <div
          class="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-2xs flex items-end justify-center p-3 pb-6"
          (click)="close()"
        >
          <div
            class="w-full max-w-xs bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            (click)="$event.stopPropagation()"
          >
            <div class="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
              <div>
                <p class="font-bold text-sm text-slate-800">{{ prefs.txt('ইনভয়েস শেয়ার করুন', 'Share invoice') }}</p>
                <p class="text-[10px] text-slate-500 mt-0.5">
                  {{ prefs.txt('WhatsApp, Messenger বা অন্য যেকোনো অ্যাপে পাঠান', 'Send to WhatsApp, Messenger or any app') }}
                </p>
              </div>
              <button type="button" (click)="close()" class="p-1 text-slate-400 hover:text-slate-700 shrink-0">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            </div>

            <div class="p-2">
              @if (preparing()) {
                <p class="px-3 pt-2 pb-1 text-[10px] font-semibold text-emerald-700 flex items-center gap-1.5">
                  <mat-icon class="text-xs animate-spin">sync</mat-icon>
                  {{ prefs.txt('ইনভয়েস প্রস্তুত হচ্ছে…', 'Preparing the invoice…') }}
                </p>
              }

              <button
                type="button"
                [disabled]="!!busy() || preparing()"
                (click)="run('image')"
                class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 cursor-pointer"
              >
                <span class="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <mat-icon class="text-base">chat</mat-icon>
                </span>
                <span class="flex-1 min-w-0">
                  <span class="block text-xs font-bold text-slate-800">{{ prefs.txt('সোশ্যাল মিডিয়ায় ছবি শেয়ার করুন', 'Share image to social media') }}</span>
                  <span class="block text-[10px] text-slate-500">
                    {{ prefs.txt('WhatsApp, Facebook, Messenger — ফোনের শেয়ার মেনু থেকে যেকোনো অ্যাপ', 'WhatsApp, Facebook, Messenger — any app from the share menu') }}
                  </span>
                </span>
                @if (busy() === 'image') {
                  <mat-icon class="text-sm animate-spin text-emerald-600">sync</mat-icon>
                } @else {
                  <mat-icon class="text-sm text-slate-300">chevron_right</mat-icon>
                }
              </button>

              <button
                type="button"
                [disabled]="!!busy() || preparing()"
                (click)="run('pdf')"
                class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 cursor-pointer"
              >
                <span class="w-9 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                  <mat-icon class="text-base">picture_as_pdf</mat-icon>
                </span>
                <span class="flex-1 min-w-0">
                  <span class="block text-xs font-bold text-slate-800">{{ prefs.txt('PDF হিসেবে পাঠান', 'Send as PDF') }}</span>
                  <span class="block text-[10px] text-slate-500">
                    {{ prefs.txt('ডকুমেন্ট আকারে সংরক্ষণযোগ্য', 'Sent as a document') }}
                  </span>
                </span>
                @if (busy() === 'pdf') {
                  <mat-icon class="text-sm animate-spin text-emerald-600">sync</mat-icon>
                } @else {
                  <mat-icon class="text-sm text-slate-300">chevron_right</mat-icon>
                }
              </button>

              <button
                type="button"
                [disabled]="!!busy() || preparing()"
                (click)="sendTextOnly()"
                class="w-full text-center rounded-xl px-3 py-2 text-[11px] font-bold text-slate-500 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 cursor-pointer"
              >
                {{ prefs.txt('শুধু মেসেজ পাঠান', 'Send text message only') }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (preview()) {
        <div
          class="fixed inset-0 z-[95] bg-slate-900/80 backdrop-blur-2xs flex items-center justify-center p-4"
          (click)="closePreview()"
        >
          <div class="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden" (click)="$event.stopPropagation()">
            <div class="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
              <div>
                <p class="font-bold text-sm text-slate-800">{{ prefs.txt('ভাউচার ছবি', 'Voucher image') }}</p>
                <p class="text-[10px] text-slate-500 mt-0.5">
                  {{ prefs.txt('এই ব্রাউজারে সরাসরি শেয়ার নেই — ছবিতে চেপে ধরে শেয়ার/সেভ করুন, অথবা নিচে সেভ চাপুন।', 'This browser has no direct share — long-press the image to share/save, or tap Save below.') }}
                </p>
              </div>
              <button type="button" (click)="closePreview()" class="p-1 text-slate-400 hover:text-slate-700 shrink-0">
                <mat-icon class="text-sm">close</mat-icon>
              </button>
            </div>
            <div class="p-3">
              <img [src]="preview()" alt="Voucher" class="w-full rounded-lg border border-slate-200" />
            </div>
            <div class="px-3 pb-3">
              <button
                type="button"
                (click)="downloadPreview()"
                class="w-full bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold py-2.5 rounded-lg cursor-pointer"
              >
                {{ prefs.txt('ছবি সেভ করুন', 'Save image') }}
              </button>
            </div>
          </div>
        </div>
      }
    }
  `
})
export class ShareInvoiceComponent {
  protected readonly prefs = inject(PreferencesService);
  private readonly notify = inject(NotificationService);

  /** The invoice / slip element exactly as shown in its preview. */
  readonly paperEl = input.required<HTMLElement>();
  /** Every sheet when a long invoice spans several pages. */
  readonly paperEls = input<HTMLElement[]>([]);
  readonly fileName = input.required<string>();
  readonly title = input.required<string>();
  readonly message = input('');
  readonly pdfWidthMm = input(210);
  /** Null keeps the paper's own aspect ratio (thermal slips). */
  readonly pdfHeightMm = input<number | null>(null);
  readonly iconOnly = input(false);

  private readonly query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_LAYOUT)
    : null;
  readonly phone = signal(this.query?.matches ?? false);

  readonly open = signal(false);
  readonly busy = signal<ShareAction | null>(null);
  /** Captured once when the sheet opens, so tapping an option opens the app sheet instantly. */
  private readonly prepared = signal<string[] | null>(null);
  readonly preparing = signal(false);
  /** Shown only when the browser cannot share and copying failed — the user saves on purpose. */
  readonly preview = signal<string | null>(null);
  private readonly previewName = signal('voucher');

  constructor() {
    if (!this.query) return;
    const onChange = (event: MediaQueryListEvent) => {
      this.phone.set(event.matches);
      if (!event.matches) this.close();
    };
    this.query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.query?.removeEventListener('change', onChange));
  }

  toggle(event: MouseEvent) {
    event.stopPropagation();
    if (this.busy()) return;
    const next = !this.open();
    this.open.set(next);
    if (next) void this.prepare();
  }

  close() {
    if (this.busy()) return;
    this.open.set(false);
    this.prepared.set(null);
  }

  private async prepare() {
    if (this.prepared() || this.preparing()) return;
    this.preparing.set(true);
    try {
      this.prepared.set(await this.captureAll());
    } catch (err) {
      console.warn('Invoice capture failed, will retry on tap', err);
    } finally {
      this.preparing.set(false);
    }
  }

  private sheets(): HTMLElement[] {
    const listed = this.paperEls().filter(Boolean);
    return listed.length ? listed : [this.paperEl()];
  }

  private async captureAll(): Promise<string[]> {
    const shots: string[] = [];
    for (const el of this.sheets()) shots.push(await captureInvoiceJpeg(el));
    return shots;
  }

  async run(kind: ShareAction) {
    if (this.busy()) return;
    this.busy.set(kind);
    try {
      const el = this.paperEl();
      const shots = this.prepared() ?? await this.captureAll();
      const jpeg = await stitchJpegsVertically(shots);
      const base = this.fileName();
      const file = kind === 'image'
        ? new File([dataUrlToBlob(jpeg)], `${base}.jpg`, { type: 'image/jpeg' })
        : new File([this.pdfBlob(shots, el)], `${base}.pdf`, { type: 'application/pdf' });

      const outcome = await shareInvoiceFile(file, { title: this.title(), text: this.message() });
      if (outcome === 'cancelled') return;
      this.open.set(false);
      this.prepared.set(null);
      if (outcome === 'shared') {
        this.notify.success(this.prefs.txt('শেয়ার করা হয়েছে', 'Shared'));
        return;
      }
      if (kind === 'image') {
        if (outcome === 'copied') {
          // Desktop without a share sheet: the image is on the clipboard, ready to paste.
          this.notify.info(this.prefs.txt('ছবি কপি হয়েছে — Facebook/WhatsApp/যেকোনো চ্যাটে Paste করুন', 'Image copied — paste it into any chat'));
        } else {
          this.previewName.set(base);
          this.preview.set(jpeg);
        }
        return;
      }
      // PDF has no share sheet here; saving only happens because the user picked PDF.
      saveBlob(file, file.name);
      this.notify.success(this.prefs.txt('PDF সেভ হয়েছে', 'PDF saved'));
    } catch (err) {
      console.error('Invoice share failed', err);
      this.notify.error(
        this.prefs.txt('শেয়ার করা যায়নি। আবার চেষ্টা করুন।', 'Could not share. Please try again.')
      );
    } finally {
      this.busy.set(null);
    }
  }

  downloadPreview() {
    const jpeg = this.preview();
    if (!jpeg) return;
    saveBlob(dataUrlToBlob(jpeg), `${this.previewName()}.jpg`);
    this.notify.success(this.prefs.txt('ছবি সেভ হয়েছে', 'Image saved'));
    this.closePreview();
  }

  closePreview() {
    this.preview.set(null);
  }

  /** Message-only fallback: opens WhatsApp with the bill details, nothing to attach. */
  sendTextOnly() {
    if (this.busy()) return;
    const opened = openWhatsApp(this.message() || this.title());
    if (!opened) {
      this.notify.warning(
        this.prefs.txt('WhatsApp খোলা যায়নি — পপআপ ব্লক হতে পারে। নতুন ট্যাবে wa.me খুলুন।', 'WhatsApp could not open — the popup may be blocked. Open wa.me in a new tab.')
      );
      return;
    }
    this.open.set(false);
    this.prepared.set(null);
  }

  private pdfBlob(shots: string[], el: HTMLElement): Blob {
    const width = this.pdfWidthMm();
    const height = this.pdfHeightMm() ?? Math.max(40, Math.round(width * (el.offsetHeight / Math.max(1, el.offsetWidth)) * 10) / 10);
    return buildJpegPdfFromPages(shots, width, height).output('blob');
  }
}
