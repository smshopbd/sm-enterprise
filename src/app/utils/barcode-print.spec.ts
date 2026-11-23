import { BarcodeLabelPreset, pageSlots, resolveLabelGrid } from './barcode-print';

describe('barcode sheet paging', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];

  it('splits the product × copies sequence into sheet pages', () => {
    expect(pageSlots(rows, 2, 4, 1)).toEqual([
      { row: 'a', copy: 0 }, { row: 'a', copy: 1 },
      { row: 'b', copy: 0 }, { row: 'b', copy: 1 },
    ]);
    expect(pageSlots(rows, 2, 4, 2)).toEqual([
      { row: 'c', copy: 0 }, { row: 'c', copy: 1 },
      { row: 'd', copy: 0 }, { row: 'd', copy: 1 },
    ]);
    expect(pageSlots(rows, 2, 4, 3)).toEqual([
      { row: 'e', copy: 0 }, { row: 'e', copy: 1 },
    ]);
  });

  it('returns nothing past the last page or without rows', () => {
    expect(pageSlots(rows, 2, 4, 4)).toEqual([]);
    expect(pageSlots([], 3, 24, 1)).toEqual([]);
    expect(pageSlots(rows, 0, 24, 1)).toEqual([]);
  });

  it('keeps every preset label inside the A4 sheet', () => {
    const presets: BarcodeLabelPreset[] = ['3x8', '3x7', '2x5', '4x10', '2x2', '1x1'];
    for (const value of presets) {
      const grid = resolveLabelGrid(value);
      expect(grid.labelW * grid.cols + grid.gapX * (grid.cols - 1) + grid.marginX * 2).toBeCloseTo(210, 1);
      expect(grid.labelH * grid.rows + grid.gapY * (grid.rows - 1) + grid.marginY * 2).toBeCloseTo(297, 1);
    }
  });
});
