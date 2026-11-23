import { planReceiptPages } from './pos-receipt-print';

const PAGE = 1000;

describe('POS receipt pagination', () => {
  it('keeps a short slip on one page', () => {
    const pages = planReceiptPages({
      rowHeights: [20, 20, 20],
      tailHeights: [100],
      firstFixed: 200,
      contFixed: 120,
      contHeadOnly: 100,
      pageHeight: PAGE
    });

    expect(pages.length).toBe(1);
    expect(pages[0].rows).toEqual([0, 1, 2]);
    expect(pages[0].tail).toEqual([0]);
  });

  it('moves overflowing rows to a second page with its own header', () => {
    const rows = Array.from({ length: 40 }, () => 25);
    const pages = planReceiptPages({
      rowHeights: rows,
      tailHeights: [150],
      firstFixed: 200,
      contFixed: 120,
      contHeadOnly: 100,
      pageHeight: PAGE
    });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap(page => page.rows)).toEqual(rows.map((_, i) => i));
    expect(pages[0].rows.length).toBeLessThan(rows.length);
    // Every continuation page starts with the continuation header.
    expect(pages[0].tail).toEqual([]);
    expect(pages[pages.length - 1].tail).toEqual([0]);
  });

  it('gives the totals their own page when the last row page is already full', () => {
    const pages = planReceiptPages({
      rowHeights: [400, 600],
      tailHeights: [300],
      firstFixed: 200,
      contFixed: 120,
      contHeadOnly: 100,
      pageHeight: PAGE
    });

    expect(pages.length).toBe(3);
    expect(pages[0].rows).toEqual([0]);
    expect(pages[1].rows).toEqual([1]);
    expect(pages[1].tail).toEqual([]);
    expect(pages[2].rows).toEqual([]);
    expect(pages[2].tail).toEqual([0]);
  });

  it('pushes a heavy tail block to a fresh page instead of clipping it', () => {
    const pages = planReceiptPages({
      rowHeights: [400],
      tailHeights: [300, 800],
      firstFixed: 200,
      contFixed: 120,
      contHeadOnly: 100,
      pageHeight: PAGE
    });

    expect(pages.length).toBe(2);
    expect(pages[0].tail).toEqual([0]);
    expect(pages[1].rows.length).toBe(0);
    expect(pages[1].tail).toEqual([1]);
  });

  it('never drops a row that is taller than a page', () => {
    const pages = planReceiptPages({
      rowHeights: [1500],
      tailHeights: [],
      firstFixed: 200,
      contFixed: 120,
      contHeadOnly: 100,
      pageHeight: PAGE
    });

    expect(pages[0].rows).toEqual([0]);
  });
});
