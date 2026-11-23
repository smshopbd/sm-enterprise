import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PreferencesService } from './preferences';
import { DigitLocalizer, localizeDigits, toBengaliDigits, toEnglishDigits } from './digit-localizer';

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, String(value)); }
  };
}

/** MutationObserver callbacks land in the microtask queue. */
const flushMutations = () => new Promise<void>(resolve => setTimeout(resolve));

describe('DigitLocalizer', () => {
  let service: DigitLocalizer | undefined;

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    // A live observer from an earlier test would fight the next one over the
    // same text nodes, so every instance is detached before the injector goes.
    service?.stop();
    service = undefined;
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('maps digits both ways and leaves every other character alone', () => {
    expect(toBengaliDigits('Sale-1001 · 1,250.50%')).toBe('Sale-১০০১ · ১,২৫০.৫০%');
    expect(toEnglishDigits('Sale-১০০১ · ১,২৫০.৫০%')).toBe('Sale-1001 · 1,250.50%');
    expect(localizeDigits('Qty 12', true)).toBe('Qty ১২');
    expect(localizeDigits('Qty ১২', false)).toBe('Qty 12');
    expect(localizeDigits('No digits here', true)).toBe('No digits here');
  });

  it('rewrites text already on screen but keeps code and icon ligatures intact', () => {
    const host = document.createElement('section');
    host.innerHTML = '<p>Total 1,250</p><code>Sale-1001</code><mat-icon>3d_rotation</mat-icon>';
    document.body.appendChild(host);

    service = TestBed.inject(DigitLocalizer);
    service.start();

    expect(host.querySelector('p')?.textContent).toBe('Total ১,২৫০');
    expect(host.querySelector('code')?.textContent).toBe('Sale-1001');
    expect(host.querySelector('mat-icon')?.textContent).toBe('3d_rotation');
  });

  it('localizes nodes rendered later and follows a language change', async () => {
    service = TestBed.inject(DigitLocalizer);
    const prefs = TestBed.inject(PreferencesService);
    service.start();

    const line = document.createElement('p');
    line.textContent = 'Sale-1001 · 12 pcs';
    document.body.appendChild(line);
    await flushMutations();
    expect(line.textContent).toBe('Sale-১০০১ · ১২ pcs');

    prefs.setLanguage('en');
    line.textContent = 'Sale-১০০২ · ১৩ pcs';
    await flushMutations();
    expect(line.textContent).toBe('Sale-1002 · 13 pcs');
  });
});
