import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PreferencesService } from './preferences';

const root = () => document.documentElement;
const hoverVar = () => root().style.getPropertyValue('--sm-table-hover').trim();

/** The unit-test environment has no localStorage, so back it with a Map. */
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

describe('Preferences table skin', () => {
  let prefs: PreferencesService;

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    TestBed.configureTestingModule({});
    prefs = TestBed.inject(PreferencesService);
  });

  afterEach(() => {
    root().removeAttribute('data-sm-border');
    root().style.removeProperty('--sm-table-hover');
    root().style.removeProperty('--sm-table-hover-dark');
    root().style.removeProperty('--sm-brand');
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('defaults to a medium accent hover and soft borders', () => {
    expect(prefs.tableHover()).toBe('medium');
    expect(prefs.tableBorder()).toBe('soft');
    expect(root().getAttribute('data-sm-border')).toBe('soft');
    expect(hoverVar()).toMatch(/^#[0-9a-f]{6}$/);
    expect(root().style.getPropertyValue('--sm-table-hover-dark').trim()).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('re-derives the hover tint from the accent colour', () => {
    prefs.setAccent('teal');
    const teal = hoverVar();
    prefs.setAccent('blue');
    expect(hoverVar()).not.toBe(teal);
    prefs.setAccent('teal');
    expect(hoverVar()).toBe(teal);
  });

  it('deepens the tint as the hover tone rises', () => {
    prefs.setTableHover('soft');
    const soft = hoverVar();
    prefs.setTableHover('deep');
    expect(hoverVar()).not.toBe(soft);
    expect(prefs.tableHoverSwatch('deep')).toBe(hoverVar());
  });

  it('persists the skin and reapplies it on the document', () => {
    prefs.setTableHover('deep');
    prefs.setTableBorder('grid');

    expect(localStorage.getItem('sm_table_hover_v1')).toBe('deep');
    expect(localStorage.getItem('sm_table_border_v1')).toBe('grid');
    expect(root().getAttribute('data-sm-border')).toBe('grid');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(PreferencesService);
    expect(reloaded.tableHover()).toBe('deep');
    expect(reloaded.tableBorder()).toBe('grid');
    expect(root().getAttribute('data-sm-border')).toBe('grid');
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem('sm_table_hover_v1', 'huge');
    localStorage.setItem('sm_table_border_v1', 'neon');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(PreferencesService);
    expect(reloaded.tableHover()).toBe('medium');
    expect(reloaded.tableBorder()).toBe('soft');
  });

  it('applies and stores an explicit light or dark choice', () => {
    prefs.setThemeMode('dark');
    expect(localStorage.getItem('sm_theme')).toBe('dark');
    expect(prefs.dark()).toBe(true);
    expect(root().classList.contains('dark')).toBe(true);

    prefs.setThemeMode('light');
    expect(prefs.dark()).toBe(false);
    expect(root().classList.contains('dark')).toBe(false);
  });

  it('resolves system mode from the device preference and keeps following it', () => {
    const listeners: (() => void)[] = [];
    const query = {
      matches: true,
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      removeEventListener: () => undefined
    };
    vi.stubGlobal('matchMedia', () => query);
    localStorage.setItem('sm_theme', 'system');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(PreferencesService);

    expect(reloaded.themeMode()).toBe('system');
    expect(reloaded.dark()).toBe(true);

    query.matches = false;
    for (const listener of listeners) listener();
    expect(reloaded.dark()).toBe(false);
  });

  it('publishes brand tokens that follow the accent', () => {
    prefs.setAccent('blue');
    expect(root().style.getPropertyValue('--sm-brand').trim()).toBe('#2563eb');
    prefs.setAccent('teal');
    expect(root().style.getPropertyValue('--sm-brand').trim()).toBe('#0d9488');
  });

  it('resets every theme choice back to the shop default', () => {
    prefs.setAccent('rose');
    prefs.setThemeMode('dark');
    prefs.setTableHover('deep');
    prefs.setTableBorder('grid');

    prefs.resetTheme();

    expect(prefs.accent()).toBe('teal');
    expect(prefs.themeMode()).toBe('light');
    expect(prefs.dark()).toBe(false);
    expect(prefs.tableHover()).toBe('medium');
    expect(prefs.tableBorder()).toBe('soft');
  });
});
