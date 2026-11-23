import { VoucherSettings } from '../services/data';
import { resolveVoucherSheet } from './voucher-print';

function settings(overrides: Partial<VoucherSettings> = {}): VoucherSettings {
  return {
    paperSize: 'A4',
    printOrientation: 'portrait',
    copiesPerPage: 1,
    customPaperWidthMm: 210,
    customPaperHeightMm: 297,
    pageMarginMm: 9,
    ...overrides
  } as VoucherSettings;
}

describe('resolveVoucherSheet', () => {
  it('gives a single A4 voucher the whole paper box so the design reflows with the paper', () => {
    const sheet = resolveVoucherSheet(settings());

    expect(sheet.pageWmm).toBe(210);
    expect(sheet.pageHmm).toBe(297);
    expect(sheet.sheetW).toBe(793);
    expect(sheet.sheetH).toBe(1122);
    expect(sheet.designW).toBe(sheet.sheetW);
    expect(sheet.designH).toBe(sheet.sheetH);
    expect(sheet.margin).toBe(34);
  });

  it('turns the millimetre margin into px inside the paper edge', () => {
    expect(resolveVoucherSheet(settings({ pageMarginMm: 0 })).margin).toBe(0);
    expect(resolveVoucherSheet(settings({ pageMarginMm: 9 })).margin).toBe(34);
    expect(resolveVoucherSheet(settings({ pageMarginMm: 30 })).margin).toBe(113);
  });

  it('clamps an out-of-range or broken margin back to 0-30 mm', () => {
    expect(resolveVoucherSheet(settings({ pageMarginMm: -5 })).margin).toBe(0);
    expect(resolveVoucherSheet(settings({ pageMarginMm: 80 })).margin).toBe(113);
    expect(resolveVoucherSheet(settings({ pageMarginMm: Number.NaN })).margin).toBe(34);
  });

  it('sizes the design to A5 and landscape paper instead of keeping the A4 canvas', () => {
    const a5 = resolveVoucherSheet(settings({ paperSize: 'A5' }));
    expect(a5.sheetW).toBe(559);
    expect(a5.sheetH).toBe(793);
    expect(a5.designW).toBe(559);
    expect(a5.designH).toBe(793);

    const landscape = resolveVoucherSheet(settings({ printOrientation: 'landscape' }));
    expect(landscape.pageWmm).toBe(297);
    expect(landscape.pageHmm).toBe(210);
    expect(landscape.designW).toBe(landscape.sheetW);
    expect(landscape.designH).toBe(landscape.sheetH);
  });

  it('sizes the design to a custom paper box', () => {
    const sheet = resolveVoucherSheet(settings({
      paperSize: 'Custom',
      customPaperWidthMm: 100,
      customPaperHeightMm: 150
    }));

    expect(sheet.sheetW).toBe(377);
    expect(sheet.sheetH).toBe(566);
    expect(sheet.designW).toBe(377);
    expect(sheet.designH).toBe(566);
  });

  it('keeps the A4 design scaled into each cell for multi-copy sheets', () => {
    const four = resolveVoucherSheet(settings({ copiesPerPage: 4 }));
    expect(four.designW).toBe(794);
    expect(four.designH).toBe(1123);

    const two = resolveVoucherSheet(settings({ copiesPerPage: 2 }));
    expect(two.cols).toBe(1);
    expect(two.rows).toBe(2);
    expect(two.designW).toBe(794);
    expect(two.cellH).toBe((two.sheetH - two.pad * 2 - two.gap) / 2);
  });
});
