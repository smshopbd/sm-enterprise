import {
  AfterViewInit,
  ChangeDetectorRef,
  Directive,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  forwardRef,
  inject
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { dmyFromIso, isoFromDmy } from '../utils/local-date';

const CALENDAR_ICON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='5' width='18' height='16' rx='2'/%3E%3Cpath d='M16 3v4M8 3v4M3 11h18'/%3E%3C/svg%3E")`;

/**
 * Native `<input type="date">` renders its text in the browser's own locale (often
 * mm/dd/yyyy) and parses typed digits in that same order — so a shopkeeper typing
 * 09/03/2026 can silently save 3 September. This directive keeps the ISO value in the
 * model (as a ControlValueAccessor) but turns the visible element into a dd/mm/yyyy
 * masked text field, with the native picker still one tap away on the calendar icon.
 */
@Directive({
  selector: 'input[type=date][appDmyDate]',
  standalone: true,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DmyDateDirective), multi: true }]
})
export class DmyDateDirective implements ControlValueAccessor, AfterViewInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cdr = inject(ChangeDetectorRef);

  private picker: HTMLInputElement | null = null;
  /** ISO value mirroring the form model. */
  private iso = '';
  private lastValue = '';
  private previousPaddingRight = '';
  private previousBackground = '';
  private previousBackgroundRepeat = '';
  private previousBackgroundPosition = '';
  private previousBackgroundSize = '';
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  private readonly onInput = () => this.applyMask();
  private readonly onBlur = () => this.commitBlur();
  private readonly onKeydown = (e: KeyboardEvent) => this.handleBackspace(e);
  private readonly onPaste = (e: ClipboardEvent) => this.handlePaste(e);
  private readonly onIconClick = (e: MouseEvent) => this.handleIconClick(e);
  private readonly onPicked = () => this.applyPicked();

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.setup();
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.el.removeEventListener('input', this.onInput);
    this.el.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('keydown', this.onKeydown);
    this.el.removeEventListener('paste', this.onPaste);
    this.el.removeEventListener('click', this.onIconClick);
    this.picker?.removeEventListener('change', this.onPicked);
    this.picker?.remove();
    this.picker = null;
    this.el.style.paddingRight = this.previousPaddingRight;
    this.el.style.backgroundImage = this.previousBackground;
    this.el.style.backgroundRepeat = this.previousBackgroundRepeat;
    this.el.style.backgroundPosition = this.previousBackgroundPosition;
    this.el.style.backgroundSize = this.previousBackgroundSize;
  }

  writeValue(value: unknown): void {
    const iso = typeof value === 'string' ? value : '';
    this.iso = iso;
    this.lastValue = iso;
    if (!isPlatformBrowser(this.platformId)) return;
    this.el.value = dmyFromIso(iso);
    if (this.picker) this.picker.value = iso;
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.el.disabled = disabled;
  }

  private setup(): void {
    const cs = getComputedStyle(this.el);
    this.previousPaddingRight = this.el.style.paddingRight;
    this.previousBackground = this.el.style.backgroundImage;
    this.previousBackgroundRepeat = this.el.style.backgroundRepeat;
    this.previousBackgroundPosition = this.el.style.backgroundPosition;
    this.previousBackgroundSize = this.el.style.backgroundSize;

    this.el.type = 'text';
    this.el.setAttribute('inputmode', 'numeric');
    this.el.setAttribute('autocomplete', 'off');
    this.el.setAttribute('spellcheck', 'false');
    if (!this.el.getAttribute('placeholder')) this.el.setAttribute('placeholder', 'dd/mm/yyyy');
    if ((parseFloat(cs.paddingRight) || 0) < 26) this.el.style.paddingRight = '26px';
    this.el.style.backgroundImage = CALENDAR_ICON;
    this.el.style.backgroundRepeat = 'no-repeat';
    this.el.style.backgroundPosition = 'right 7px center';
    this.el.style.backgroundSize = '14px 14px';
    this.el.value = dmyFromIso(this.iso);

    // The native picker lives in a 1px, invisible input so the calendar icon keeps the
    // browser's own month grid without a second visible field on the page.
    const picker = document.createElement('input');
    picker.type = 'date';
    picker.className = 'dmy-native-picker';
    picker.tabIndex = -1;
    picker.setAttribute('aria-hidden', 'true');
    picker.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;margin:0;border:0;opacity:0;pointer-events:none;';
    picker.value = this.iso;
    picker.addEventListener('change', this.onPicked);
    (this.el.parentElement || document.body).appendChild(picker);
    this.picker = picker;

    this.el.addEventListener('input', this.onInput);
    this.el.addEventListener('blur', this.onBlur);
    this.el.addEventListener('keydown', this.onKeydown);
    this.el.addEventListener('paste', this.onPaste);
    this.el.addEventListener('click', this.onIconClick);
  }

  private handleIconClick(e: MouseEvent): void {
    const rect = this.el.getBoundingClientRect();
    // Only the icon strip (right edge) opens the picker; the rest of the field types.
    if (e.clientX < rect.right - Math.min(30, rect.width / 2)) return;
    e.preventDefault();
    this.openPicker();
  }

  private openPicker(): void {
    const picker = this.picker;
    if (!picker) return;
    picker.value = this.iso;
    const rect = this.el.getBoundingClientRect();
    picker.style.left = `${Math.round(rect.left)}px`;
    picker.style.top = `${Math.round(rect.bottom)}px`;
    if (typeof picker.showPicker === 'function') {
      try {
        picker.showPicker();
        return;
      } catch {
        /* fall through for browsers that refuse the programmatic open */
      }
    }
    // Older mobile browsers: focus a full-size, invisible date field so the native wheel opens.
    picker.style.width = `${Math.round(rect.width)}px`;
    picker.style.height = `${Math.round(rect.height)}px`;
    picker.style.top = `${Math.round(rect.top)}px`;
    picker.focus();
    picker.click();
  }

  private applyPicked(): void {
    const iso = this.picker?.value || '';
    if (!iso) return;
    this.setIso(iso);
    this.onTouched();
  }

  private applyMask(): void {
    const el = this.el;
    const raw = el.value;
    const caret = el.selectionStart ?? raw.length;
    const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    const masked = this.formatDigits(digits);
    el.value = masked;
    const pos = this.caretFor(masked, digitsBefore);
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* some mobile keyboards reject selection writes mid-IME */
    }
    this.syncModel(digits, masked);
  }

  private handleBackspace(e: KeyboardEvent): void {
    if (e.key !== 'Backspace') return;
    const el = this.el;
    if (el.selectionStart !== el.selectionEnd) return;
    const caret = el.selectionStart ?? 0;
    if (caret === 0) return;
    const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
    if (!digitsBefore) return;
    // The auto-inserted slash must never block deleting the digit before it.
    e.preventDefault();
    const digits = el.value.replace(/\D/g, '');
    const next = digits.slice(0, digitsBefore - 1) + digits.slice(digitsBefore);
    const masked = this.formatDigits(next);
    el.value = masked;
    const pos = this.caretFor(masked, digitsBefore - 1);
    el.setSelectionRange(pos, pos);
    this.syncModel(next, masked);
  }

  private handlePaste(e: ClipboardEvent): void {
    const text = (e.clipboardData?.getData('text') || '').trim();
    const dashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (dashed) {
      e.preventDefault();
      const iso = isoFromDmy(`${dashed[1].padStart(2, '0')}/${dashed[2].padStart(2, '0')}/${dashed[3]}`);
      if (iso) this.setIso(iso);
      return;
    }
    const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (isoMatch) {
      e.preventDefault();
      const iso = isoFromDmy(`${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`);
      if (iso) this.setIso(iso);
    }
  }

  private commitBlur(): void {
    const digits = this.el.value.replace(/\D/g, '');
    if (digits.length === 8) {
      const iso = isoFromDmy(this.el.value);
      this.iso = iso;
      this.el.value = dmyFromIso(iso);
      this.emit(iso);
    } else {
      // Incomplete or impossible text falls back to the last value the model has.
      this.el.value = dmyFromIso(this.iso);
    }
    this.onTouched();
  }

  private syncModel(digits: string, masked: string): void {
    if (digits.length === 8) {
      const iso = isoFromDmy(masked);
      this.iso = iso;
      if (this.picker) this.picker.value = iso;
      this.emit(iso);
    } else if (digits.length === 0) {
      this.iso = '';
      if (this.picker) this.picker.value = '';
      this.emit('');
    }
  }

  private setIso(iso: string): void {
    this.iso = iso;
    this.el.value = dmyFromIso(iso);
    if (this.picker) this.picker.value = iso;
    this.emit(iso);
  }

  private emit(iso: string): void {
    if (iso === this.lastValue) return;
    this.lastValue = iso;
    this.onChange(iso);
    this.cdr.markForCheck();
  }

  private formatDigits(digits: string): string {
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  /** Caret position just after `count` digits, skipping the auto-inserted slashes. */
  private caretFor(masked: string, count: number): number {
    let pos = 0;
    let seen = 0;
    while (pos < masked.length && seen < count) {
      if (/\d/.test(masked[pos])) seen++;
      pos++;
    }
    return pos;
  }
}
