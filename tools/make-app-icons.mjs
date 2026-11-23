// Generates the PWA / home-screen icons from code so the repo needs no binary editor.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT_DIR = resolve('public/icons');

const CRC_TABLE = new Int32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // no filter
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GLYPHS = {
  S: ['01110', '10001', '10000', '01110', '00001', '10001', '01110'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
};

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function insideRounded(x, y, size, radius) {
  if (radius <= 0) return true;
  const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
  const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function drawIcon(size, { maskable }) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const safeScale = maskable ? 0.78 : 1;

  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const src = a / 255;
    const dst = pixels[i + 3] / 255;
    const out = src + dst * (1 - src);
    if (out === 0) return;
    pixels[i] = Math.round((r * src + pixels[i] * dst * (1 - src)) / out);
    pixels[i + 1] = Math.round((g * src + pixels[i + 1] * dst * (1 - src)) / out);
    pixels[i + 2] = Math.round((b * src + pixels[i + 2] * dst * (1 - src)) / out);
    pixels[i + 3] = Math.round(out * 255);
  };

  const fillRect = (x0, y0, w, h, r, g, b, a = 255) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(size, x0 + w); x++) put(x, y, r, g, b, a);
    }
  };

  // Teal gradient plate with a soft diagonal highlight.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRounded(x, y, size, radius)) continue;
      const t = y / size;
      const glow = Math.max(0, 1 - Math.hypot(x / size - 0.22, y / size - 0.16) * 1.9);
      put(
        x,
        y,
        mix(mix(13, 15, t), 94, glow * 0.55),
        mix(mix(148, 118, t), 234, glow * 0.55),
        mix(mix(136, 110, t), 212, glow * 0.5),
        255
      );
    }
  }

  // Inner ring.
  const ringInset = Math.round(size * (maskable ? 0.13 : 0.075));
  const ringWidth = Math.max(2, Math.round(size * 0.012));
  const ringRadius = Math.round(size * (maskable ? 0.16 : 0.17));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < ringInset || y < ringInset || x >= size - ringInset || y >= size - ringInset) continue;
      if (insideRounded(x - ringInset, y - ringInset, size - ringInset * 2, ringRadius)) {
        const edge =
          x < ringInset + ringWidth || y < ringInset + ringWidth ||
          x >= size - ringInset - ringWidth || y >= size - ringInset - ringWidth;
        if (edge) put(x, y, 255, 255, 255, 46);
      }
    }
  }

  // "SM" block letters.
  const pixel = Math.max(2, Math.round(size * 0.066 * safeScale));
  const glyphW = 5 * pixel;
  const glyphH = 7 * pixel;
  const gap = Math.round(pixel * 1.3);
  const totalW = glyphW * 2 + gap;
  const left = Math.round((size - totalW) / 2);
  const top = Math.round((size - glyphH) / 2) - Math.round(size * 0.02);
  const drawGlyph = (glyph, x0) => {
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((bit, colIndex) => {
        if (bit === '1') fillRect(x0 + colIndex * pixel, top + rowIndex * pixel, pixel, pixel, 255, 255, 255, 255);
      });
    });
  };
  drawGlyph(GLYPHS.S, left);
  drawGlyph(GLYPHS.M, left + glyphW + gap);

  // Thin barcode strip under the monogram.
  const barTop = top + glyphH + Math.round(pixel * 1.15);
  const barHeight = Math.max(3, Math.round(size * 0.018));
  const pattern = [5, 2, 2, 4, 2, 2, 3, 2, 5, 2, 2, 3];
  let cursor = left;
  const unit = pixel * 0.55;
  for (const width of pattern) {
    const w = Math.max(2, Math.round(width * unit));
    if (cursor + w <= left + totalW) fillRect(cursor, barTop, w, barHeight, 255, 255, 255, 225);
    cursor += w + Math.max(2, Math.round(2 * unit));
  }

  return encodePng(size, pixels);
}

mkdirSync(dirname(resolve(OUT_DIR, 'icon.png')), { recursive: true });
writeFileSync(resolve(OUT_DIR, 'icon-192.png'), drawIcon(192, { maskable: false }));
writeFileSync(resolve(OUT_DIR, 'icon-512.png'), drawIcon(512, { maskable: false }));
writeFileSync(resolve(OUT_DIR, 'maskable-512.png'), drawIcon(512, { maskable: true }));
writeFileSync(resolve(OUT_DIR, 'apple-touch-icon.png'), drawIcon(180, { maskable: true }));
console.log('icons written to public/icons');
