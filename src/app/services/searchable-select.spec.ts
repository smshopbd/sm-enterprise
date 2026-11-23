import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SearchableSelectService } from './searchable-select';
import { PreferencesService } from './preferences';

function setup() {
  TestBed.configureTestingModule({ providers: [
    SearchableSelectService,
    { provide: PreferencesService, useValue: { language: signal<'bn' | 'en'>('bn'), txt: (_bn: string, en: string) => en } }
  ] });
  document.body.innerHTML = '<select id="status"><option value="Ordered">Ordered</option><option value="Completed">Completed</option></select>';
  const service = TestBed.inject(SearchableSelectService);
  service.start();
  const select = document.getElementById('status') as HTMLSelectElement;
  return { service, select };
}

const tap = (el: HTMLElement) => el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

describe('SearchableSelectService mobile tap handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
    // jsdom has no layout, so the sheet's active-option scroll is a no-op here.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById('ss-select-styles')?.remove();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('keeps the sheet open when the opening tap produces a trailing click on the backdrop', () => {
    const { select } = setup();
    tap(select);
    const panel = document.querySelector<HTMLElement>('.ss-panel')!;
    const backdrop = document.querySelector<HTMLElement>('.ss-backdrop')!;
    expect(panel.style.display).toBe('flex');

    backdrop.click();
    expect(panel.style.display).toBe('flex');

    vi.setSystemTime(new Date('2026-11-11T10:00:01Z'));
    backdrop.click();
    expect(panel.style.display).toBe('none');
  });

  it('selects an option from the sheet and updates the real select', () => {
    const { select } = setup();
    const changes = vi.fn();
    select.addEventListener('change', changes);
    tap(select);

    const items = document.querySelectorAll<HTMLElement>('.ss-item');
    expect(items).toHaveLength(2);
    items[1].click();

    expect(select.value).toBe('Completed');
    expect(changes).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLElement>('.ss-panel')!.style.display).toBe('none');
  });
});
