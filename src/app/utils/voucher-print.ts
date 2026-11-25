import { VoucherSettings } from '../services/data';
import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';

const MM_TO_PX = 96 / 25.4;

export interface VoucherSheet {
  pageWmm: number;
  pageHmm: number;
  landscape: boolean;
  paperSize: 'A4' | 'A5' | 'Custom';
  copies: number;
  cols: number;
  rows: number;
  sheetW: number;
  sheetH: number;
  pad: number;
  gap: number;
  cellW: number;
  cellH: number;
  /** White border inside the paper edge, in px, from `pageMarginMm`. */
  margin: number;
  designW: number;
  designH: number;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
}

export function resolveVoucherSheet(settings: VoucherSettings): VoucherSheet {
  let pageWmm = 210;
  let pageHmm = 297;
  let paperSize: VoucherSheet['paperSize'] = 'A4';

  if (settings.paperSize === 'A5') {
    paperSize = 'A5';
    pageWmm = 148;
    pageHmm = 210;
  } else if (settings.paperSize === 'Custom') {
    paperSize = 'Custom';
    pageWmm = clamp(settings.customPaperWidthMm, 60, 600, 210);
    pageHmm = clamp(settings.customPaperHeightMm, 60, 600, 297);
  }

  const landscape = settings.printOrientation === 'landscape';
  if (landscape) {
    [pageWmm, pageHmm] = [pageHmm, pageWmm];
  }

  const copies = settings.copiesPerPage === 4 ? 4 : settings.copiesPerPage === 2 ? 2 : 1;
  const cols = copies === 4 ? 2 : copies === 2 ? (landscape ? 2 : 1) : 1;
  const rows = copies === 4 ? 2 : copies === 2 ? (landscape ? 1 : 2) : 1;

  const sheetW = Math.floor(pageWmm * MM_TO_PX);
  const sheetH = Math.floor(pageHmm * MM_TO_PX);
  const marginMm = clamp(settings.pageMarginMm, 0, 30, 9);
  const margin = Math.round(marginMm * MM_TO_PX);
  const pad = copies > 1 ? 10 : 0;
  const gap = copies > 1 ? 10 : 0;
  const cellW = (sheetW - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = (sheetH - pad * 2 - gap * (rows - 1)) / rows;
  // A single voucher takes the real paper box so the design reflows with the
  // chosen paper and margin instead of being a fixed A4 canvas scaled down.
  // Multi-copy sheets keep the A4 design and shrink it into each cell.
  const single = copies === 1;
  const designW = single ? Math.round(cellW) : 794;
  const designH = single ? Math.round(cellH) : Math.round(designW * pageHmm / pageWmm);

  return {
    pageWmm,
    pageHmm,
    landscape,
    paperSize,
    copies,
    cols,
    rows,
    sheetW,
    sheetH,
    pad,
    gap,
    cellW,
    cellH,
    margin,
    designW,
    designH
  };
}

export interface VoucherPrintTarget {
  /** The first simulated sheet (`.voucher-print-paper`); also used by single-sheet vouchers. */
  paperEl: HTMLElement;
  /** Every rendered sheet when a long voucher spills onto more pages. */
  paperEls?: HTMLElement[];
  sheet: VoucherSheet;
  /** File name without extension. */
  fileName: string;
  title: string;
}

function sheetsOf(target: VoucherPrintTarget): HTMLElement[] {
  return target.paperEls?.length ? target.paperEls : [target.paperEl];
}

/**
 * Standard sizes are named so the print driver picks its own A4/A5 paper
 * instead of a custom media box — Canon LBP and similar lasers otherwise
 * rescale or clip the sheet. Custom paper keeps the explicit millimetres.
 */
export function voucherPageSizeCss(sheet: VoucherSheet): string {
  if (sheet.paperSize === 'Custom') return `${sheet.pageWmm}mm ${sheet.pageHmm}mm`;
  return `${sheet.paperSize} ${sheet.landscape ? 'landscape' : 'portrait'}`;
}

function printPageCss(sheet: VoucherSheet): string {
  return `
@page { size: ${voucherPageSizeCss(sheet)}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { width: ${sheet.sheetW}px; }
.voucher-print-scaler { width: auto !important; height: auto !important; margin: 0 !important; overflow: visible !important; }
.voucher-print-scaler + .voucher-print-scaler { break-before: page; page-break-before: always; }
.voucher-print-paper { box-shadow: none !important; transform: none !important; break-inside: avoid; }
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

async function collectStyleText(): Promise<string> {
  const chunks: string[] = [];
  document.querySelectorAll('style').forEach(style => {
    if (style.textContent) chunks.push(style.textContent);
  });
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  await Promise.all(links.map(async link => {
    if (!link.href) return;
    try {
      if (new URL(link.href).origin !== window.location.origin) return;
      const response = await fetch(link.href, { cache: 'force-cache' });
      if (response.ok) chunks.push(await response.text());
    } catch {
      // A stylesheet that cannot be read is skipped rather than blocking the export.
    }
  }));
  return chunks.join('\n');
}

/**
 * Cross-origin sheets (the Kalpurush Bengali webfont) cannot be read from here, but the
 * print frame can load them itself. Without them the printed voucher loses its Bengali face.
 */
function externalStylesheetTags(): string {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .filter(link => {
      try {
        return link.href && new URL(link.href).origin !== window.location.origin;
      } catch {
        return false;
      }
    })
    .map(link => `<link rel="stylesheet" href="${escapeHtml(link.href)}">`)
    .join('\n');
}

async function whenFontsReady(doc: Document, timeoutMs = 4000): Promise<void> {
  const ready = doc.fonts.ready.then(() => undefined);
  await Promise.race([ready, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);
}

function cloneSheet(paperEl: HTMLElement): HTMLElement {
  const clone = paperEl.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  return clone;
}

async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async img => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    try {
      const response = await fetch(new URL(src, document.baseURI).href, { mode: 'cors' });
      if (!response.ok) return;
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      img.setAttribute('src', dataUrl);
      img.removeAttribute('crossorigin');
    } catch {
      // Keep the remote URL so the browser can still try to load it.
    }
  }));
}

/**
 * Shared by every "print exactly what the preview shows" flow: the live app
 * styles (locale fonts included) plus a page rule written last so it wins.
 */
export async function standaloneHeadHtml(pageCss: string): Promise<string> {
  const styles = await collectStyleText();
  return `${externalStylesheetTags()}
<style>${styles}</style>
<style>${pageCss}</style>`;
}

export async function buildVoucherStandaloneHtml(target: VoucherPrintTarget): Promise<string> {
  const sheets: string[] = [];
  for (const paperEl of sheetsOf(target)) {
    const clone = cloneSheet(paperEl);
    await inlineImages(clone);
    sheets.push(`<div class="voucher-print-scaler">${clone.outerHTML}</div>`);
  }
  const head = await standaloneHeadHtml(printPageCss(target.sheet));
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(target.title)}</title>
${head}
</head>
<body>
${sheets.join('\n')}
</body>
</html>`;
}

async function whenImagesReady(doc: Document): Promise<void> {
  await Promise.all(Array.from(doc.images).map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  }));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * Prints a detached copy of the preview sheet instead of re-laying-out the live app,
 * so the printed page cannot drift from what the user sees on screen.
 */
export async function printStandaloneHtml(
  html: string,
  frameSize: { widthPx: number; heightPx: number }
): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    `position:fixed;left:-100000px;top:0;border:0;background:#fff;` +
    `width:${frameSize.widthPx}px;height:${frameSize.heightPx}px;`;
  document.body.appendChild(frame);

  const frameDoc = frame.contentDocument;
  const frameWin = frame.contentWindow;
  if (!frameDoc || !frameWin) {
    frame.remove();
    throw new Error('Print frame could not be created.');
  }
  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  await whenImagesReady(frameDoc);
  await whenFontsReady(frameDoc);

  const cleanup = () => {
    frameWin.removeEventListener('afterprint', cleanup);
    frame.remove();
  };
  frameWin.addEventListener('afterprint', cleanup);
  frameWin.focus();
  frameWin.print();
  setTimeout(cleanup, 90000);
}

export async function printVoucherSheet(target: VoucherPrintTarget): Promise<void> {
  const html = await buildVoucherStandaloneHtml(target);
  await printStandaloneHtml(html, {
    widthPx: target.sheet.sheetW,
    heightPx: target.sheet.sheetH * sheetsOf(target).length
  });
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] || 'application/octet-stream';
  if (head.includes('base64')) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

async function captureSheet(paperEl: HTMLElement, kind: 'png' | 'jpeg'): Promise<string> {
  // cacheBust would re-fetch the remote QR image and font CSS on every export, which stalls the capture.
  const options = { quality: 0.96, backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: false };
  const previousTransform = paperEl.style.transform;
  paperEl.style.transform = 'none';
  try {
    await whenFontsReady(document);
    const shoot = kind === 'png' ? htmlToImage.toPng : htmlToImage.toJpeg;
    try {
      return await shoot(paperEl, options);
    } catch (err) {
      console.warn('Capture with embedded fonts failed, retrying without fonts...', err);
      return await shoot(paperEl, { ...options, skipFonts: true });
    }
  } finally {
    paperEl.style.transform = previousTransform;
  }
}

async function captureSheets(target: VoucherPrintTarget, kind: 'png' | 'jpeg'): Promise<string[]> {
  const shots: string[] = [];
  for (const paperEl of sheetsOf(target)) shots.push(await captureSheet(paperEl, kind));
  return shots;
}

export async function downloadVoucherHtml(target: VoucherPrintTarget): Promise<void> {
  const html = await buildVoucherStandaloneHtml(target);
  saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${target.fileName}.html`);
}

function fileNamesFor(base: string, count: number, extension: string): string[] {
  if (count <= 1) return [`${base}.${extension}`];
  return Array.from({ length: count }, (_, index) => `${base}-page-${index + 1}.${extension}`);
}

export async function downloadVoucherJpg(target: VoucherPrintTarget): Promise<number> {
  const shots = await captureSheets(target, 'jpeg');
  return saveShots(shots, fileNamesFor(target.fileName, shots.length, 'jpg'));
}

export async function downloadVoucherPng(target: VoucherPrintTarget): Promise<number> {
  const shots = await captureSheets(target, 'png');
  return saveShots(shots, fileNamesFor(target.fileName, shots.length, 'png'));
}

/**
 * Chrome treats a burst of programmatic saves as automatic downloads and can
 * drop every file after the first, so each page is handed over separately.
 */
async function saveShots(shots: string[], names: string[]): Promise<number> {
  for (let index = 0; index < shots.length; index++) {
    saveBlob(dataUrlToBlob(shots[index]), names[index]);
    if (index < shots.length - 1) await new Promise<void>(resolve => setTimeout(resolve, 400));
  }
  return shots.length;
}

export async function downloadVoucherPdf(target: VoucherPrintTarget): Promise<void> {
  const shots = await captureSheets(target, 'jpeg');
  const { pageWmm, pageHmm } = target.sheet;
  const orientation = pageWmm > pageHmm ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [pageWmm, pageHmm] });
  shots.forEach((dataUrl, index) => {
    if (index > 0) pdf.addPage([pageWmm, pageHmm], orientation);
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWmm, pageHmm);
  });
  pdf.save(`${target.fileName}.pdf`);
}

export type VoucherLayoutPreset =
  | 'A4-1'
  | 'A4L-1'
  | 'A4-4'
  | 'A4L-4'
  | 'A5-1'
  | 'A5L-1'
  | 'A5-4'
  | 'A5L-4'
  | 'CUSTOM';

export interface VoucherLayoutOption {
  value: VoucherLayoutPreset;
  label: string;
}

export const VOUCHER_LAYOUT_OPTIONS: VoucherLayoutOption[] = [
  { value: 'A4-1', label: 'A4 · 1 copy' },
  { value: 'A4L-1', label: 'A4 Landscape · 1 copy' },
  { value: 'A4-4', label: 'A4 · 4 copies (2×2)' },
  { value: 'A4L-4', label: 'A4 Landscape · 4 copies' },
  { value: 'A5-1', label: 'Half A4 (A5) · 1 copy' },
  { value: 'A5L-1', label: 'Half A4 Landscape · 1 copy' },
  { value: 'A5-4', label: 'Half A4 (A5) · 4 copies' },
  { value: 'A5L-4', label: 'Half A4 Landscape · 4 copies' },
  { value: 'CUSTOM', label: 'Custom (set in settings)' },
];

export function layoutPresetOf(settings: VoucherSettings): VoucherLayoutPreset {
  if (settings.paperSize === 'Custom') return 'CUSTOM';
  const prefix = settings.paperSize === 'A5' ? 'A5' : 'A4';
  const landscape = settings.printOrientation === 'landscape';
  const copies = settings.copiesPerPage === 4 ? 4 : settings.copiesPerPage === 2 ? 2 : 1;

  if (prefix === 'A5') {
    if (landscape) return copies === 4 ? 'A5L-4' : 'A5L-1';
    return copies === 4 ? 'A5-4' : 'A5-1';
  }
  if (landscape) return copies === 4 ? 'A4L-4' : 'A4L-1';
  return copies === 4 ? 'A4-4' : 'A4-1';
}

export function presetSettings(preset: VoucherLayoutPreset): Partial<VoucherSettings> {
  switch (preset) {
    case 'A4L-1':
      return { paperSize: 'A4', printOrientation: 'landscape', copiesPerPage: 1 };
    case 'A4-4':
      return { paperSize: 'A4', printOrientation: 'portrait', copiesPerPage: 4 };
    case 'A4L-4':
      return { paperSize: 'A4', printOrientation: 'landscape', copiesPerPage: 4 };
    case 'A5-1':
      return { paperSize: 'A5', printOrientation: 'portrait', copiesPerPage: 1 };
    case 'A5L-1':
      return { paperSize: 'A5', printOrientation: 'landscape', copiesPerPage: 1 };
    case 'A5-4':
      return { paperSize: 'A5', printOrientation: 'portrait', copiesPerPage: 4 };
    case 'A5L-4':
      return { paperSize: 'A5', printOrientation: 'landscape', copiesPerPage: 4 };
    case 'A4-1':
      return { paperSize: 'A4', printOrientation: 'portrait', copiesPerPage: 1 };
    default:
      return {};
  }
}
