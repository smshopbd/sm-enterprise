import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, effect, inject } from '@angular/core';
import { PreferencesService } from './preferences';

/** Bengali digits in code-point order, so index 0 is zero. */
const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * Text that must keep its ASCII digits: code samples, editable text, and
 * Material icon ligatures (e.g. `3d_rotation`) which are matched by name.
 */
const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'code',
  'pre',
  'samp',
  'kbd',
  'svg',
  'mat-icon',
  '.material-icons',
  '.material-symbols-outlined',
  '.material-symbols-rounded',
  '.material-symbols-sharp',
  '[data-plain-digits]',
  '[contenteditable="true"]',
  '[contenteditable=""]'
].join(',');

export function toBengaliDigits(text: string): string {
  return text.replace(/[0-9]/g, digit => BENGALI_DIGITS[digit.charCodeAt(0) - 48]);
}

export function toEnglishDigits(text: string): string {
  return text.replace(/[০-৯]/g, digit => String(BENGALI_DIGITS.indexOf(digit)));
}

export function localizeDigits(text: string, bengali: boolean): string {
  return bengali ? toBengaliDigits(text) : toEnglishDigits(text);
}

/**
 * Renders every visible number in the app's current language. Values stay
 * stored as plain numbers; only the text nodes on screen are rewritten, so the
 * language switch also revives numbers that were rendered before the toggle.
 */
@Injectable({ providedIn: 'root' })
export class DigitLocalizer {
  private readonly prefs = inject(PreferencesService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: MutationObserver;
  private started = false;

  constructor() {
    if (!this.browser) return;
    effect(() => {
      const bengali = this.prefs.language() === 'bn';
      if (!this.started) return;
      // Let Angular finish painting the language it just switched to first.
      queueMicrotask(() => this.refresh(bengali));
    });
  }

  start(): void {
    if (!this.browser || this.started || typeof document === 'undefined' || !document.body) return;
    this.started = true;
    this.refresh(this.prefs.language() === 'bn');
    this.observer = new MutationObserver(records => {
      const bengali = this.prefs.language() === 'bn';
      for (const record of records) {
        if (record.type === 'characterData') {
          this.convert(record.target, bengali);
          continue;
        }
        for (const node of Array.from(record.addedNodes)) this.convertSubtree(node, bengali);
      }
    });
    this.observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.started = false;
  }

  private refresh(bengali: boolean): void {
    if (typeof document === 'undefined' || !document.body) return;
    this.convertSubtree(document.body, bengali);
  }

  private convertSubtree(node: Node, bengali: boolean): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.convert(node, bengali);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.closest(SKIP_SELECTOR) || el.matches(SKIP_SELECTOR)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: candidate =>
        candidate.nodeType === Node.ELEMENT_NODE
          ? ((candidate as Element).matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
          : NodeFilter.FILTER_ACCEPT
    });
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      this.convert(current, bengali);
    }
  }

  private convert(node: Node, bengali: boolean): void {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_SELECTOR)) return;
    const text = node.nodeValue;
    if (!text) return;
    const next = localizeDigits(text, bengali);
    if (next !== text) node.nodeValue = next;
  }
}
