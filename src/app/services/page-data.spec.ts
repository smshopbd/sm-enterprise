import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { CloudService } from './cloud';
import { PageDataService } from './page-data';

class FakeCloud {
  readonly config = signal({ autoSync: true, supabase: { enabled: true } });
  readonly calls: string[][] = [];
  scope: string[] = [];
  gate: Promise<void> = Promise.resolve();
  private open?: () => void;

  isEnabled(): boolean {
    return true;
  }

  setActiveScope(keys: string[]): void {
    this.scope = keys;
  }

  syncPage(keys: string[]): Promise<void> {
    this.calls.push(keys);
    return this.gate;
  }

  /** Holds the next pull open until `finish()` is called. */
  hold(): void {
    this.gate = new Promise<void>(resolve => { this.open = resolve; });
  }

  finish(): void {
    this.open?.();
    this.gate = Promise.resolve();
  }
}

if (!getTestBed().platform) {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}
afterEach(() => TestBed.resetTestingModule());

function setup(): { pages: PageDataService; cloud: FakeCloud } {
  const cloud = new FakeCloud();
  TestBed.configureTestingModule({ providers: [{ provide: CloudService, useValue: cloud }] });
  return { pages: TestBed.inject(PageDataService), cloud };
}

describe('page data loading', () => {
  it('resolves the longest matching route prefix', () => {
    const { pages } = setup();
    expect(pages.keysFor('/product-manager/products/42')).toContain('sm_products_v2');
    expect(pages.keysFor('/product-manager/products/42')).not.toContain('sm_sales_v1');
    expect(pages.keysFor('/app-info')).toEqual([]);
  });

  it('pulls the unit list wherever products are shown, and in settings', () => {
    const { pages } = setup();
    expect(pages.keysFor('/product-manager/products')).toContain('sm_units_v1');
    expect(pages.keysFor('/settings')).toContain('sm_units_v1');
    expect(pages.keysFor('/pos')).toContain('sm_units_v1');
  });

  it('reports a pull as loading only while it is running', async () => {
    const { pages, cloud } = setup();
    cloud.hold();
    pages.enter('/sales');
    expect(cloud.scope).toContain('sm_sales_v1');
    expect(cloud.calls).toHaveLength(1);
    expect(pages.loading()).toBe(true);
    cloud.finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pages.loading()).toBe(false);
  });

  it('does not re-pull a page entered again within the revisit window', async () => {
    const { pages, cloud } = setup();
    pages.enter('/stock');
    await new Promise(resolve => setTimeout(resolve, 0));
    pages.enter('/stock');
    expect(cloud.calls).toHaveLength(1);
    pages.enter('/stock', true);
    expect(cloud.calls).toHaveLength(2);
  });
});
