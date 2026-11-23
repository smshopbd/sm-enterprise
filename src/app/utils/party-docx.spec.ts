import { PartyDocxMeta, PartyDocxRow, partyDocxBlob, partyDocxFileName } from './party-docx';

const meta: PartyDocxMeta = {
  title: 'সব',
  scope: 'বিক্রয় + ক্রয় (নেট)',
  search: '',
  sort: 'ডিফল্ট',
  dueLabel: 'নেট বাকি',
  generated: '19-11-2026, 17:30',
  totals: { total: 1500, paid: 500, due: 1000 },
  shop: { name: 'SM Enterprise', address: 'Dhaka', mobile: '01700000000', email: '' }
};

function row(sl: number, due: number): PartyDocxRow {
  return { sl, name: `পার্টি ${sl}`, company: 'কোম্পানি', roles: 'কাস্টমার', phone: '017', address: 'ঢাকা', total: 500, paid: 200, due };
}

describe('party docx export', () => {
  it('names the file with the current date', () => {
    expect(partyDocxFileName()).toMatch(/^Party-List-\d{4}-\d{2}-\d{2}\.docx$/);
  });

  it('builds a non-empty Word document', async () => {
    const blob = await partyDocxBlob([row(1, 300), row(2, 700)], meta);
    expect(blob.size).toBeGreaterThan(2000);
    expect(blob.type).toContain('wordprocessingml');
  });

  it('still builds a document for an empty list', async () => {
    const blob = await partyDocxBlob([], { ...meta, totals: { total: 0, paid: 0, due: 0 } });
    expect(blob.size).toBeGreaterThan(1000);
  });
});
