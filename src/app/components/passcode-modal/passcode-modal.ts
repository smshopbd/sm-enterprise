import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SessionService } from '../../services/session';
import { PreferencesService } from '../../services/preferences';

@Component({
  selector: 'app-passcode-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4" [style.z-index]="elevate() ? 80 : null" (click)="close.emit()">
      <div
        class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
        (click)="$event.stopPropagation()"
      >
        <div class="bg-slate-900 text-white px-5 py-4 flex items-start justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-9 h-9 shrink-0 rounded-full bg-amber-400/15 text-amber-300 flex items-center justify-center">
              <mat-icon>lock</mat-icon>
            </span>
            <div class="min-w-0">
              <h3 class="font-bold text-sm leading-tight">{{ title() || prefs.txt('অর্ডার লক করা আছে', 'Locked Order') }}</h3>
              <p class="text-[10px] text-slate-400 mt-0.5">{{ prefs.txt('অ্যাডমিন PIN প্রয়োজন', 'Admin PIN required') }}</p>
            </div>
          </div>
          <button (click)="close.emit()" class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 shrink-0" [title]="prefs.txt('বন্ধ করুন', 'Close')">
            <mat-icon class="text-sm">close</mat-icon>
          </button>
        </div>

        <div class="p-5 space-y-3 text-xs text-slate-700">
          <p class="leading-relaxed">{{ message() || prefs.txt('কনফার্ম করা অর্ডার লক করা আছে। ইডিট করার জন্য Admin PIN দিন।', 'This confirmed order is locked. Enter the Admin PIN to edit it.') }}</p>

          <div>
            <label class="block font-bold text-slate-700 mb-1">{{ prefs.txt('অ্যাডমিন পিন', 'Admin PIN') }}</label>
            <div class="relative">
              <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm">key</mat-icon>
              <input
                #pin
                [type]="showCode() ? 'text' : 'password'"
                [value]="code()"
                (input)="onInput($event)"
                (keyup.enter)="submit()"
                inputmode="numeric"
                autocomplete="off"
                placeholder="••••••••"
                class="w-full pl-9 pr-10 py-2.5 border-2 rounded-lg font-mono font-bold tracking-widest text-slate-900 bg-white focus:outline-none"
                [class.border-rose-400]="error()"
                [class.border-slate-300]="!error()"
                [class.focus:border-teal-500]="!error()"
              />
              <button
                type="button"
                (click)="toggleCode()"
                class="absolute right-2 top-2 p-1 text-slate-400 hover:text-slate-700 rounded"
                [title]="showCode() ? prefs.txt('পাসকোড লুকান', 'Hide passcode') : prefs.txt('পাসকোড দেখান', 'Show passcode')"
              >
                <mat-icon class="text-sm">{{ showCode() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </div>
            @if (error()) {
              <p class="text-[11px] text-rose-600 font-bold mt-1 flex items-center gap-1">
                <mat-icon class="text-xs">error</mat-icon> {{ prefs.txt('ভুল পাসকোড! আবার চেষ্টা করুন।', 'Wrong passcode! Try again.') }}
              </p>
            }
          </div>
        </div>

        <div class="bg-slate-50 px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 text-xs">
          <button (click)="close.emit()" class="border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-lg transition-colors">
            {{ prefs.txt('বাতিল', 'Cancel') }}
          </button>
          <button
            (click)="submit()"
            class="bg-teal-700 hover:bg-teal-800 text-white font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-xs transition-all active:scale-95"
          >
            <mat-icon class="text-sm">lock_open</mat-icon> {{ prefs.txt('আনলক করুন', 'Unlock') }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class PasscodeModal implements AfterViewInit {
  private session = inject(SessionService);
  readonly prefs = inject(PreferencesService);

  readonly title = input<string>('');
  readonly message = input<string>('');
  /** Raise the overlay above a drawer/modal that already sits higher than z-60. */
  readonly elevate = input<boolean>(false);
  readonly verified = output<string>();
  readonly close = output<void>();

  readonly code = signal('');
  readonly error = signal(false);
  readonly showCode = signal(false);
  private readonly pinInput = viewChild<ElementRef<HTMLInputElement>>('pin');

  ngAfterViewInit() {
    // The modal only exists while open, so this focuses the PIN field on open.
    this.pinInput()?.nativeElement.focus();
  }

  onInput(event: Event) {
    this.code.set((event.target as HTMLInputElement).value);
    this.error.set(false);
  }

  toggleCode() {
    this.showCode.update(value => !value);
  }

  submit() {
    const value = this.code().trim();
    if (!this.session.verifyAdminPin(value)) {
      this.error.set(true);
      return;
    }
    this.verified.emit(value);
  }
}
