import {
  QR_TEXT_MAX_BYTES,
  clipToBytes,
  returnNoteQrText,
  saleQrText,
  utf8Size
} from './voucher-qr';

const shop = { businessNamePart1: 'এস এম', businessNamePart2: 'এন্টারপ্রাইজ' };

describe('saleQrText', () => {
  it('prints the bill summary without any app link', () => {
    const text = saleQrText({
      invoice: 'INV-1001',
      date: '2026-11-19',
      customerName: 'রহিম',
      mobile: '01700000000',
      total: 1250,
      paid: 1000,
      due: 250,
      items: [
        { productName: 'Battery', quantity: 2, unit: 'pcs', total: 200 },
        { productName: 'Charger', quantity: 1, unit: 'pcs', total: 50 }
      ]
    }, shop);

    expect(text).toContain('এস এম এন্টারপ্রাইজ');
    expect(text).toContain('SALE INV-1001 | 19-11-2026');
    expect(text).toContain('Customer: রহিম 01700000000');
    expect(text).toContain('Total: 1250 TK');
    expect(text).toContain('Paid: 1000 TK | Due: 250 TK');
    expect(text).toContain('2 Battery = 200 TK');
    expect(text).not.toMatch(/https?:|smshopbd|\/v\//);
  });

  it('keeps a long item list inside the byte budget and counts the skipped ones', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      productName: `Product ${i + 1}`,
      quantity: 1,
      unit: 'pcs',
      total: 100
    }));
    const text = saleQrText({
      invoice: 'INV-2000',
      date: '19-11-2026',
      customerName: 'Customer',
      total: 4000,
      paid: 0,
      due: 4000,
      items
    }, shop);

    expect(utf8Size(text)).toBeLessThanOrEqual(QR_TEXT_MAX_BYTES);
    expect(text).toContain('Items (40):');
    expect(text).toMatch(/\+\d+ more/);
  });
});

describe('utf8Size and clipToBytes', () => {
  it('counts Bengali letters as three bytes each', () => {
    expect(utf8Size('a')).toBe(1);
    expect(utf8Size('এ')).toBe(3);
    expect(utf8Size('এa')).toBe(4);
  });

  it('never splits a multi-byte letter while clipping', () => {
    const clipped = clipToBytes('এসএম', 4);
    expect(clipped).toBe('এ');
    expect(utf8Size(clipped)).toBeLessThanOrEqual(4);
    expect(clipToBytes('abc', 10)).toBe('abc');
  });
});

describe('returnNoteQrText', () => {
  it('builds a debit-note summary with its party and lines', () => {
    const text = returnNoteQrText({
      kind: 'dr',
      docNo: 'DR-1002',
      date: '2026-11-05',
      partyName: 'Supplier',
      phone: '01800000000',
      total: 500,
      lines: [{ productName: 'Battery', quantity: 3, unit: 'pcs', total: 450 }]
    }, shop);

    expect(text).toContain('DEBIT NOTE DR-1002 | 05-11-2026');
    expect(text).toContain('Party: Supplier 01800000000');
    expect(text).toContain('3 Battery = 450 TK');
  });
});
