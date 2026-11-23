import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PrintBarcode } from './print-barcode';
import { DataService, Product } from '../../../services/data';
import { NotificationService } from '../../../services/notification';
import { PreferencesService } from '../../../services/preferences';

function product(id: number, extra: Partial<Product> = {}): Product {
  return {
    id, name: `Product ${id}`, code: `9${String(id).padStart(7, '0')}`,
    rack: '', type: 'single', category: 'Mobile', brand: 'Samsung', model: 'M1',
    stock: 1, unit: 'পিস', salesPrice: 100, purchasePrice: 80, wholesalePrice: 90,
    ...extra
  };
}

function setup(products: Product[]) {
  TestBed.configureTestingModule({ providers: [
    {
      provide: DataService, useValue: {
        products: signal(products),
        categories: signal([{ id: 1, name: 'Mobile' }]),
        subCategories: signal([{ id: 2, name: 'Phone', parentCategory: 'Mobile' }]),
        brands: signal([{ id: 1, name: 'Samsung' }]),
        productModels: signal([{ id: 1, name: 'M1' }]),
        voucherSettings: signal({ businessNamePart1: 'SM', businessNamePart2: 'Enterprise' })
      }
    },
    { provide: PreferencesService, useValue: { txt: (_bn: string, en: string) => en } },
    { provide: NotificationService, useValue: { error: () => undefined } }
  ] });
  return TestBed.runInInjectionContext(() => new PrintBarcode());
}

afterEach(() => TestBed.resetTestingModule());

describe('print barcode page', () => {
  const many = Array.from({ length: 30 }, (_, index) => product(index + 1));

  it('pages through every label instead of stopping at the first sheet', () => {
    const page = setup(many);
    expect(page.pageCount()).toBe(2);
    expect(page.previewLabels().length).toBe(24);
    expect(page.previewLabels()[0].name).toBe('Product 1');
    page.goToPage(2);
    expect(page.previewLabels().length).toBe(6);
    expect(page.previewLabels()[0].name).toBe('Product 25');
    expect(page.previewLabels().at(-1)?.svg).toBeTruthy();
  });

  it('repeats every product for the chosen copies', () => {
    const page = setup(many);
    page.copies.set(2);
    expect(page.pageCount()).toBe(3);
    expect(page.previewLabels().slice(0, 2).map(label => label.name)).toEqual(['Product 1', 'Product 1']);
  });

  it('filters by brand, category and search, then starts again at page one', () => {
    const page = setup([
      product(1, { name: 'Galaxy S23', category: 'Mobile', brand: 'Samsung' }),
      product(2, { name: 'Nokia 1100', category: 'Mobile', brand: 'Nokia' }),
      product(3, { name: 'USB Cable', category: 'Accessory', brand: 'Samsung' })
    ]);
    page.goToPage(2);
    page.selectedBrand.set('Samsung');
    page.resetSheet();
    expect(page.matchedCount()).toBe(2);
    page.selectedCategory.set('c:1');
    expect(page.matchedCount()).toBe(1);
    page.clearFilters();
    page.searchQuery.set('nokia');
    expect(page.matchedCount()).toBe(1);
    expect(page.currentPage()).toBe(1);
  });
});
