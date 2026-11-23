import {TestBed} from '@angular/core/testing';
import {vi} from 'vitest';
import {App} from './app';
import {SessionService} from './services/session';

function stubScreen(matches: (query: string) => boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  }));
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('lands on the POS for a phone screen and on the catalogue otherwise', () => {
    stubScreen(query => query.includes('max-width: 1023px'));
    const app = TestBed.createComponent(App).componentInstance;
    vi.spyOn(TestBed.inject(SessionService), 'canSee').mockReturnValue(true);

    expect((app as unknown as { landingPath(): string }).landingPath()).toBe('/pos');
    vi.unstubAllGlobals();

    stubScreen(() => false);
    expect((app as unknown as { landingPath(): string }).landingPath()).toBe('/product-manager/products');
  });

  it('keeps users without POS access on the catalogue even on a phone', () => {
    stubScreen(query => query.includes('max-width: 1023px'));
    const app = TestBed.createComponent(App).componentInstance;
    vi.spyOn(TestBed.inject(SessionService), 'canSee').mockReturnValue(false);

    expect((app as unknown as { landingPath(): string }).landingPath()).toBe('/product-manager/products');
  });
});
