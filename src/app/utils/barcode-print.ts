import { printStandaloneHtml } from './voucher-print';

export type BarcodeLabelPreset = '3x8' | '3x7' | '2x5' | '4x10' | '2x2' | '1x1';

export interface BarcodeLabelGrid {
  value: BarcodeLabelPreset;
  labelBn: string;
  labelEn: string;
  cols: number;
  rows: number;
  marginX: number;
  marginY: number;
  gapX: number;
  gapY: number;
  labelW: number;
  labelH: number;
}

const PRESETS: Omit<BarcodeLabelGrid, 'labelW' | 'labelH'>[] = [
  { value: '3x8', labelBn: 'A4 · ২৪টি লেবেল (৬৩×৩৩ মিমি)', labelEn: 'A4 · 24 labels (63×33 mm)', cols: 3, rows: 8, marginX: 5, marginY: 8, gapX: 4.75, gapY: 2.5 },
  { value: '3x7', labelBn: 'A4 · ২১টি লেবেল (৬৩×৩৮ মিমি)', labelEn: 'A4 · 21 labels (63×38 mm)', cols: 3, rows: 7, marginX: 5, marginY: 6, gapX: 4.75, gapY: 3 },
  { value: '2x5', labelBn: 'A4 · ১০টি বড় লেবেল (৯৪×৫১ মিমি)', labelEn: 'A4 · 10 large labels (94×51 mm)', cols: 2, rows: 5, marginX: 8, marginY: 8, gapX: 6, gapY: 6 },
  { value: '4x10', labelBn: 'A4 · ৪০টি ছোট লেবেল (৪৮×২৭ মিমি)', labelEn: 'A4 · 40 small labels (48×27 mm)', cols: 4, rows: 10, marginX: 5, marginY: 5, gapX: 2, gapY: 2 },
  { value: '2x2', labelBn: 'A4 · ৪টি জাম্বো লেবেল (৯৬×১৩৯ মিমি)', labelEn: 'A4 · 4 jumbo labels (96×139 mm)', cols: 2, rows: 2, marginX: 7, marginY: 7, gapX: 4, gapY: 4 },
  { value: '1x1', labelBn: 'A4 · ১টি পূর্ণ পৃষ্ঠার লেবেল', labelEn: 'A4 · 1 full-page label', cols: 1, rows: 1, marginX: 10, marginY: 10, gapX: 0, gapY: 0 },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveLabelGrid(value: BarcodeLabelPreset): BarcodeLabelGrid {
  const preset = PRESETS.find(candidate => candidate.value === value) ?? PRESETS[0];
  const usableW = 210 - preset.marginX * 2 - preset.gapX * (preset.cols - 1);
  const usableH = 297 - preset.marginY * 2 - preset.gapY * (preset.rows - 1);
  return {
    ...preset,
    labelW: round(usableW / preset.cols),
    labelH: round(usableH / preset.rows),
  };
}

export const BARCODE_LABEL_PRESETS: BarcodeLabelGrid[] = PRESETS.map(preset => resolveLabelGrid(preset.value));

export interface LabelTextSizes {
  shop: number;
  name: number;
  code: number;
  price: number;
  bars: number;
}

export function labelTextSizes(grid: BarcodeLabelGrid): LabelTextSizes {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value * 100) / 100));
  return {
    shop: clamp(grid.labelH * 0.062, 1.8, 5.5),
    name: clamp(grid.labelH * 0.085, 2.3, 8),
    code: clamp(grid.labelH * 0.078, 2.1, 7),
    price: clamp(grid.labelH * 0.12, 3, 12),
    bars: clamp(grid.labelH * 0.36, 7, 45),
  };
}

export interface BarcodeSheetLabel {
  name: string;
  /** Text the scanner will send; matches the encoded digits. */
  codeText: string;
  price: number;
  svg: string;
}

export interface LabelSlot<T> {
  row: T;
  /** 0-based copy of this row on the sheet. */
  copy: number;
}

/**
 * The sheet is one flat label sequence (each product repeated `copies` times);
 * this slices the sequence into the labels of one A4 page, so the preview and
 * the printed sheet agree page for page.
 */
export function pageSlots<T>(rows: T[], copies: number, perPage: number, page: number): LabelSlot<T>[] {
  if (!rows.length || copies <= 0 || perPage <= 0) return [];
  const start = Math.max(0, (page - 1) * perPage);
  const end = Math.min(rows.length * copies, start + perPage);
  const slots: LabelSlot<T>[] = [];
  for (let flat = start; flat < end; flat++) {
    const row = rows[Math.floor(flat / copies)];
    if (row) slots.push({ row, copy: flat % copies });
  }
  return slots;
}

export interface BarcodeSheetOptions {
  title: string;
  shopName: string;
  grid: BarcodeLabelGrid;
  cutLines: boolean;
  labels: BarcodeSheetLabel[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

function labelMarkup(label: BarcodeSheetLabel, shopName: string, cutLines: boolean): string {
  const bars = label.svg ? `<div class="bars">${label.svg}</div>` : '';
  return `<div class="label${cutLines ? ' cut' : ''}">
<p class="shop">${escapeHtml(shopName)}</p>
<p class="name">${escapeHtml(label.name)}</p>
${bars}
<p class="code">${escapeHtml(label.codeText)}</p>
<p class="price">${(Number(label.price) || 0).toFixed(2)} TK</p>
</div>`;
}

export function buildBarcodeSheetHtml(options: BarcodeSheetOptions, headHtml: string): string {
  const grid = options.grid;
  const sizes = labelTextSizes(grid);
  const perPage = grid.cols * grid.rows;
  const pages: BarcodeSheetLabel[][] = [];
  for (let index = 0; index < options.labels.length; index += perPage) {
    pages.push(options.labels.slice(index, index + perPage));
  }
  if (!pages.length) pages.push([]);

  const pageCss = `
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { width: 210mm; }
.sheet { width: 210mm; }
.page {
  width: 210mm; height: 297mm; box-sizing: border-box; overflow: hidden;
  display: grid;
  grid-template-columns: repeat(${grid.cols}, ${grid.labelW}mm);
  grid-auto-rows: ${grid.labelH}mm;
  column-gap: ${grid.gapX}mm; row-gap: ${grid.gapY}mm;
  padding: ${grid.marginY}mm ${grid.marginX}mm;
  align-content: start; justify-content: start;
  break-after: page; page-break-after: always;
}
.page:last-child { break-after: auto; page-break-after: auto; }
.label {
  box-sizing: border-box; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.4mm; padding: 0.8mm 1.2mm; text-align: center;
  color: #0f172a; background: #fff;
  font-family: 'Kalpurush', 'Noto Sans Bengali', 'Hind Siliguri', system-ui, sans-serif;
  line-height: 1.1;
}
.label.cut { border: 0.2mm dashed #d6dde6; border-radius: 0.8mm; }
.label .shop {
  width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-size: ${sizes.shop}mm; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
}
.label .name {
  width: 100%; font-size: ${sizes.name}mm; font-weight: 700;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.label .bars { width: 100%; height: ${sizes.bars}mm; display: flex; align-items: center; justify-content: center; }
.label .bars svg { height: 100%; width: auto; max-width: 100%; display: block; }
.label .code { font-family: 'Consolas', 'Courier New', monospace; font-size: ${sizes.code}mm; font-weight: 700; letter-spacing: 0.06em; }
.label .price { font-size: ${sizes.price}mm; font-weight: 900; color: #0f766e; }
@media print {
  /* The app print sheet hides everything outside its own printable areas; this
     document has none, so every label must be made visible again. */
  body, body * { visibility: visible !important; }
}
`;

  const pagesHtml = pages.map(labels =>
    `<section class="page">${labels.map(label =>
      labelMarkup(label, options.shopName, options.cutLines)).join('\n')}</section>`
  ).join('\n');

  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title)}</title>
${headHtml}
<style>${pageCss}</style>
</head>
<body>
<div class="sheet">${pagesHtml}</div>
</body>
</html>`;
}

export async function printBarcodeSheetHtml(html: string): Promise<void> {
  await printStandaloneHtml(html, { widthPx: 794, heightPx: 1123 });
}
