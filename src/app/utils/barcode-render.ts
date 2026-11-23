import JsBarcode from 'jsbarcode';

export type BarcodeFormat = 'CODE128' | 'CODE39' | 'EAN13' | 'EAN8' | 'UPCA';

export const BARCODE_FORMATS: { value: BarcodeFormat; label: string }[] = [
  { value: 'CODE128', label: 'CODE 128' },
  { value: 'CODE39', label: 'CODE 39' },
  { value: 'EAN13', label: 'EAN-13' },
  { value: 'EAN8', label: 'EAN-8' },
  { value: 'UPCA', label: 'UPC-A' },
];

export interface RenderedBarcode {
  svg: string;
  /** Human-readable digits/characters that the scanner will actually send. */
  text: string;
  format: BarcodeFormat;
}

const cache = new Map<string, RenderedBarcode>();

export function normalizeSymbology(value: string | null | undefined): BarcodeFormat {
  const key = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (key.includes('39')) return 'CODE39';
  if (key.includes('128')) return 'CODE128';
  if (key.includes('EAN8') || key.includes('EAN-8')) return 'EAN8';
  if (key.includes('UPC')) return 'UPCA';
  if (key.includes('EAN13') || key === 'EAN' || key.includes('EAN')) return 'EAN13';
  return 'CODE128';
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function checkDigit(body: string): number {
  // EAN-13 starts weighting at 1, while EAN-8 and UPC-A start at 3.
  const first = body.length % 2 === 0 ? 1 : 3;
  const sum = body.split('').reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? first : 4 - first), 0);
  return (10 - (sum % 10)) % 10;
}

/** Pads/shortens to a full GTIN body and appends the correct check digit. */
function gtinValue(value: string, length: 13 | 12 | 8): string | null {
  let digits = digitsOnly(value);
  if (!digits) return null;
  // A full code already carries its check digit, which is recomputed below.
  if (digits.length >= length) digits = digits.slice(-length).slice(0, -1);
  const body = digits.slice(-(length - 1)).padStart(length - 1, '0');
  return body + checkDigit(body);
}

function sanitizeCode128(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '') || '0';
}

/**
 * Picks the encoder value for a product code. Anything that cannot be encoded
 * in the requested symbology falls back to CODE 128 so the label still prints.
 */
export function encodeBarcode(code: string, symbology: BarcodeFormat): { format: BarcodeFormat; value: string } {
  const raw = String(code ?? '').trim();
  const numeric = /^\d+$/.test(raw);
  switch (symbology) {
    case 'EAN13': {
      const value = numeric ? gtinValue(raw, 13) : null;
      return value ? { format: 'EAN13', value } : { format: 'CODE128', value: sanitizeCode128(raw) };
    }
    case 'EAN8': {
      const value = numeric ? gtinValue(raw, 8) : null;
      return value ? { format: 'EAN8', value } : { format: 'CODE128', value: sanitizeCode128(raw) };
    }
    case 'UPCA': {
      const value = numeric ? gtinValue(raw, 12) : null;
      return value ? { format: 'UPCA', value } : { format: 'CODE128', value: sanitizeCode128(raw) };
    }
    case 'CODE39': {
      const value = raw.toUpperCase();
      return /^[0-9A-Z\-. $/+%]+$/.test(value)
        ? { format: 'CODE39', value }
        : { format: 'CODE128', value: sanitizeCode128(raw) };
    }
    default:
      return { format: 'CODE128', value: sanitizeCode128(raw) };
  }
}

/**
 * Renders a barcode to inline SVG markup. Returns null on the server and for
 * values no encoder accepts; callers then print the text without bars.
 */
export function renderBarcodeSvg(code: string, symbology: BarcodeFormat): RenderedBarcode | null {
  if (typeof document === 'undefined') return null;
  const { format, value } = encodeBarcode(code, symbology);
  const key = `${format}|${value}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, {
      format: format === 'UPCA' ? 'UPC' : format,
      width: 2,
      height: 60,
      displayValue: false,
      margin: 0,
      background: 'transparent',
      lineColor: '#0f172a',
    });
    const rendered: RenderedBarcode = { svg: svg.outerHTML, text: value, format };
    cache.set(key, rendered);
    return rendered;
  } catch (error) {
    console.warn(`Barcode could not be rendered as ${format}: ${value}`, error);
    return null;
  }
}
