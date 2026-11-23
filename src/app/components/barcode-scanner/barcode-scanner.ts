import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PreferencesService } from '../../services/preferences';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code'];

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/**
 * Modal camera scanner for POS / sales. Uses the browser's BarcodeDetector,
 * falls back to typed entry where the API is missing (Firefox, older Safari).
 */
@Component({
  selector: 'app-barcode-scanner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm">
        <div class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
          <div class="flex items-center justify-between gap-2 border-b border-slate-700 bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 px-4 py-3">
            <span class="flex items-center gap-2 text-sm font-black">
              <mat-icon class="text-lg">qr_code_scanner</mat-icon>
              {{ prefs.txt('ক্যামেরায় বারকোড স্ক্যান', 'Scan barcode with camera') }}
            </span>
            <button type="button" (click)="close()" class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/15 hover:bg-white/25" [attr.aria-label]="prefs.txt('বন্ধ করুন', 'Close')">
              <mat-icon class="text-lg">close</mat-icon>
            </button>
          </div>

          <div class="relative bg-black">
            <video #video class="h-64 w-full object-cover" playsinline muted autoplay></video>
            <div class="pointer-events-none absolute inset-6 rounded-xl border-2 border-teal-300/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]"></div>
            <p class="absolute inset-x-0 bottom-2 text-center text-[10px] font-bold text-white/90 drop-shadow">
              {{ prefs.txt('বারকোডটি ফ্রেমের ভেতরে ধরুন', 'Hold the barcode inside the frame') }}
            </p>
          </div>

          <div class="space-y-3 p-4">
            @if (error()) {
              <p class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-200">{{ error() }}</p>
            } @else if (continuous()) {
              <p class="text-[11px] font-semibold text-slate-300">
                {{ prefs.txt('একটার পর একটা লেবেল স্ক্যান করুন; সব শেষে বন্ধ করুন।', 'Scan labels one after another; close the camera when done.') }}
              </p>
              @if (lastScan()) {
                <p class="rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-[11px] font-semibold text-teal-200">
                  {{ prefs.txt('সর্বশেষ', 'Last') }}:
                  <span class="font-mono">{{ lastScan() }}</span>
                  <span class="ml-1 text-teal-300/80">· {{ prefs.txt(scanCount() + 'টি যোগ হয়েছে', scanCount() + ' added') }}</span>
                </p>
              }
            } @else {
              <p class="text-[11px] font-semibold text-slate-300">
                {{ prefs.txt('স্ক্যান হলোেই পণ্যটি স্বয়ংক্রিয়ভাবে যোগ হবে।', 'A successful scan adds the product automatically.') }}
              </p>
            }

            <div class="flex items-center gap-2">
              <input
                type="text"
                [value]="manual()"
                (input)="manual.set($any($event.target).value)"
                (keyup.enter)="submitManual()"
                [placeholder]="prefs.txt('ক্যামেরা না চললে কোড লিখুন', 'If the camera fails, type the code')"
                class="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-xs font-semibold text-slate-100 placeholder:text-slate-500 focus:border-teal-400 focus:outline-none"
              />
              <button type="button" (click)="submitManual()"
                class="cursor-pointer rounded-lg bg-teal-600 px-3 py-2 text-[11px] font-black text-white hover:bg-teal-500">
                {{ prefs.txt('যোগ করুন', 'Add') }}
              </button>
            </div>

            <div class="flex items-center justify-between gap-2">
              <button type="button" (click)="flip()"
                class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-600 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-800">
                <mat-icon class="text-sm">flip_camera_ios</mat-icon> {{ prefs.txt('ক্যামেরা বদল', 'Flip camera') }}
              </button>
              <span class="text-[10px] font-semibold text-slate-400">{{ prefs.txt('EAN · UPC · CODE128 · QR', 'EAN · UPC · CODE128 · QR') }}</span>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class BarcodeScanner {
  protected readonly prefs = inject(PreferencesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly scanned = output<string>();
  /** Keep the camera open and emit every new label instead of closing after the first. */
  readonly continuous = input(false);
  readonly open = signal(false);
  readonly error = signal('');
  readonly manual = signal('');
  readonly lastScan = signal('');
  readonly scanCount = signal(0);

  private stream?: MediaStream;
  private detector?: BarcodeDetectorLike;
  private timer?: number;
  private facing: 'environment' | 'user' = 'environment';
  private lastValue = '';
  private missedTicks = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.stop());
  }

  async launch() {
    if (this.open()) return;
    this.error.set('');
    this.manual.set('');
    this.lastScan.set('');
    this.scanCount.set(0);
    this.lastValue = '';
    this.missedTicks = 0;
    this.open.set(true);
    // Let Angular render the <video> before asking for the stream.
    await new Promise(resolve => setTimeout(resolve, 60));
    await this.startCamera();
  }

  close() {
    this.stop();
    this.open.set(false);
  }

  async flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    await this.startCamera();
  }

  submitManual() {
    const code = this.manual().trim();
    if (!code) return;
    this.emitScan(code);
    if (this.continuous()) {
      this.manual.set('');
      return;
    }
    this.stop();
    this.open.set(false);
  }

  private emitScan(raw: string) {
    this.lastScan.set(raw);
    this.scanCount.update(count => count + 1);
    this.scanned.emit(raw);
  }

  private stop() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.detector = undefined;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
  }

  private async startCamera() {
    const video = this.videoRef()?.nativeElement;
    if (!video || !this.open()) return;
    this.stop();
    this.error.set('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this.facing }, width: { ideal: 1280 } },
        audio: false
      });
      if (!this.open()) {
        this.stop();
        return;
      }
      video.srcObject = this.stream;
      await video.play();
      this.startDetectLoop(video);
    } catch {
      this.error.set(this.prefs.txt(
        'ক্যামেরা চালু করা যায়নি। ব্রাউজারে ক্যামেরার অনুমতি দিন, অথবা নিচে কোড লিখে যোগ করুন।',
        'Camera could not start. Allow camera permission in the browser, or type the code below.'
      ));
    }
  }

  private async startDetectLoop(video: HTMLVideoElement) {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) {
      this.error.set(this.prefs.txt(
        'এই ব্রাউজারে ক্যামেরা স্ক্যানার নেই — Chrome/Android ব্যবহার করুন, অথবা কোড লিখে যোগ করুন।',
        'This browser has no camera scanner — use Chrome/Android, or type the code below.'
      ));
      return;
    }
    let formats = FORMATS;
    try {
      const supported = await Detector.getSupportedFormats?.();
      if (Array.isArray(supported) && supported.length) {
        const usable = FORMATS.filter(format => supported.includes(format));
        if (usable.length) formats = usable;
      }
    } catch { /* keep the default list */ }
    try {
      this.detector = new Detector({ formats });
    } catch {
      this.error.set(this.prefs.txt(
        'স্ক্যানার চালু হয়নি — কোড লিখে যোগ করুন।',
        'The scanner could not start — type the code instead.'
      ));
      return;
    }

    const tick = async () => {
      if (!this.open() || !this.detector) return;
      try {
        const codes = await this.detector.detect(video);
        if (!this.open() || !this.detector) return;
        const raw = String(codes?.[0]?.rawValue || '').trim();
        if (raw) {
          this.missedTicks = 0;
          // The same label stays in frame for many ticks; it only counts as a
          // new scan after leaving the frame for a moment.
          if (raw !== this.lastValue) {
            this.lastValue = raw;
            navigator.vibrate?.(60);
            this.emitScan(raw);
            if (!this.continuous()) {
              this.stop();
              this.open.set(false);
              return;
            }
          }
        } else {
          this.missedTicks++;
          if (this.missedTicks >= 4) this.lastValue = '';
        }
      } catch { /* frame skipped, try the next one */ }
      this.timer = window.setTimeout(tick, 180);
    };
    void tick();
  }
}
