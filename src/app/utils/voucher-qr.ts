export interface QrShopName {
  businessNamePart1?: string;
  businessNamePart2?: string;
}

export interface QrTextItem {
  productName?: string;
  quantity?: number;
  unit?: string;
  total?: number;
}

export interface QrTextSale {
  invoice?: string;
  date?: string;
  customerName?: string;
  mobile?: string;
  total?: number;
  paid?: number;
  due?: number;
  items?: readonly QrTextItem[];
}

export interface QrTextNote {
  kind: 'dr' | 'cr';
  docNo?: string;
  date?: string;
  partyName?: string;
  phone?: string;
  total?: number;
  lines?: readonly QrTextItem[];
}

/**
 * Text QR payload budget in UTF-8 bytes. A 380-byte payload stays around QR
 * version 11 (61 modules), which still scans from a 75px printed code.
 */
export const QR_TEXT_MAX_BYTES = 380;

export function shopTitle(shop: QrShopName): string {
  return [(shop.businessNamePart1 || '').trim(), (shop.businessNamePart2 || '').trim()]
    .filter(Boolean)
    .join(' ');
}

export function utf8Size(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Cuts by whole characters so a multi-byte letter is never split in half. */
export function clipToBytes(text: string, maxBytes: number): string {
  let used = 0;
  let out = '';
  for (const ch of text) {
    const size = utf8Size(ch);
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out;
}

/** QR payload for a sale voucher: the bill summary, readable without any app or internet. */
export function saleQrText(sale: QrTextSale, shop: QrShopName, maxBytes = QR_TEXT_MAX_BYTES): string {
  const head = [
    shopTitle(shop),
    [`SALE ${sale.invoice || ''}`.trim(), dmy(sale.date)].filter(Boolean).join(' | '),
    [sale.customerName ? `Customer: ${sale.customerName}` : '', sale.mobile].filter(Boolean).join(' '),
    sale.total != null ? `Total: ${money(sale.total)} TK` : '',
    amountLine(sale)
  ];
  return compose(head, (sale.items || []).map(itemLine), maxBytes);
}

/** QR payload for a debit note (purchase return); credit notes never carry a QR. */
export function returnNoteQrText(note: QrTextNote, shop: QrShopName, maxBytes = QR_TEXT_MAX_BYTES): string {
  const heading = note.kind === 'dr' ? 'DEBIT NOTE' : 'CREDIT NOTE';
  const head = [
    shopTitle(shop),
    [`${heading} ${note.docNo || ''}`.trim(), dmy(note.date)].filter(Boolean).join(' | '),
    [note.partyName ? `Party: ${note.partyName}` : '', note.phone].filter(Boolean).join(' '),
    note.total != null ? `Total: ${money(note.total)} TK` : ''
  ];
  return compose(head, (note.lines || []).map(itemLine), maxBytes);
}

function amountLine(sale: QrTextSale): string {
  const paid = sale.paid != null ? `Paid: ${money(sale.paid)} TK` : '';
  const due = sale.due != null ? `Due: ${money(sale.due)} TK` : '';
  return [paid, due].filter(Boolean).join(' | ');
}

function itemLine(item: QrTextItem): string {
  const name = shortText(item.productName || 'Item', 26);
  const qty = Number(item.quantity) || 0;
  const unit = (item.unit || '').trim();
  const qtyText = unit && unit.toLowerCase() !== 'pcs' ? `${qty} ${shortText(unit, 12)}` : String(qty);
  const total = item.total != null ? ` = ${money(item.total)} TK` : '';
  return `${qtyText} ${name}${total}`;
}

/** Head lines first; item lines are added until the budget ends, then "+N more". */
function compose(head: string[], itemLines: string[], maxBytes: number): string {
  const headText = head.filter(Boolean).join('\n');
  if (!itemLines.length) return clipToBytes(headText, maxBytes);

  const header = `Items (${itemLines.length}):`;
  let used = utf8Size(headText) + 1 + utf8Size(header);
  if (used > maxBytes) return clipToBytes(headText, maxBytes);

  const kept: string[] = [];
  for (const line of itemLines) {
    const cost = 1 + utf8Size(line);
    if (used + cost > maxBytes) break;
    kept.push(line);
    used += cost;
  }
  if (!kept.length) return clipToBytes(headText, maxBytes);

  while (kept.length && itemLines.length > kept.length) {
    const more = `+${itemLines.length - kept.length} more`;
    if (used + 1 + utf8Size(more) <= maxBytes) break;
    used -= 1 + utf8Size(kept.pop() as string);
  }
  if (kept.length && itemLines.length > kept.length) {
    kept.push(`+${itemLines.length - kept.length} more`);
  }
  return clipToBytes([headText, header, ...kept].join('\n'), maxBytes);
}

function money(value: number): string {
  return String(Math.round((Number(value) || 0) * 100) / 100);
}

function dmy(value?: string): string {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : value;
}

function shortText(value: string, maxChars: number): string {
  const chars = Array.from(value.trim());
  return chars.length > maxChars ? chars.slice(0, maxChars - 1).join('') + '…' : chars.join('');
}
