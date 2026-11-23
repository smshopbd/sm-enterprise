import { A4_LIST_ROWS_FIRST, A4_LIST_ROWS_NEXT, PartyListRow, paginatePartyRows, paginatePartyRowsByHeight } from './party-list-document';

function row(sl: number): PartyListRow {
  return { sl, name: `Party ${sl}`, company: '', roles: '', phone: '', address: '', total: 0, paid: 0, due: 0 };
}

describe('paginatePartyRows', () => {
  it('returns no pages for an empty list', () => {
    expect(paginatePartyRows([])).toEqual([]);
  });

  it('keeps a short list on a single first page', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1));
    const pages = paginatePartyRows(rows);
    expect(pages.length).toBe(1);
    expect(pages[0].length).toBe(12);
  });

  it('fills the first page to its cap and the rest to the continuation cap', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1));
    const pages = paginatePartyRows(rows);
    expect(pages[0].length).toBe(A4_LIST_ROWS_FIRST);
    expect(pages[1].length).toBe(A4_LIST_ROWS_NEXT);
    expect(pages[2].length).toBe(100 - A4_LIST_ROWS_FIRST - A4_LIST_ROWS_NEXT);
    expect(pages.every(page => page.length <= A4_LIST_ROWS_NEXT)).toBe(true);
  });

  it('preserves row order across pages', () => {
    const rows = Array.from({ length: 80 }, (_, i) => row(i + 1));
    const flat = paginatePartyRows(rows).flat();
    expect(flat.map(r => r.sl)).toEqual(rows.map(r => r.sl));
  });

  it('accepts custom caps', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1));
    const pages = paginatePartyRows(rows, 3, 2);
    expect(pages.map(page => page.length)).toEqual([3, 2, 2]);
  });
});

describe('paginatePartyRowsByHeight', () => {
  it('returns no pages for an empty list', () => {
    expect(paginatePartyRowsByHeight([], 100, 100)).toEqual([]);
  });

  it('fills the first page, then uses the taller continuation room', () => {
    const heights = Array.from({ length: 6 }, () => 10);
    expect(paginatePartyRowsByHeight(heights, 25, 40)).toEqual([2, 4]);
  });

  it('keeps every row exactly once when heights vary', () => {
    const sizes = paginatePartyRowsByHeight([20, 35, 18, 22, 30, 16, 24], 80, 60);
    expect(sizes).toEqual([3, 2, 2]);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(7);
  });

  it('breaks before a row that would overflow the room', () => {
    expect(paginatePartyRowsByHeight([30, 30, 30], 59, 59)).toEqual([1, 1, 1]);
  });

  it('never drops a row taller than the whole page', () => {
    expect(paginatePartyRowsByHeight([200, 10], 50, 50)).toEqual([1, 1]);
  });
});
