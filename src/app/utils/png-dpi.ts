const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Tags a PNG with its physical resolution (pHYs), so print dialogs place it at
 * the size the layout was drawn for instead of guessing 72 or 96 DPI.
 */
export function pngWithDpi(dataUrl: string, dpi = 300): string {
  if (!dataUrl.startsWith('data:image/png;base64,')) return dataUrl;
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const png = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) png[i] = binary.charCodeAt(i);

  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((b, i) => png[i] !== b)) return dataUrl;

  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(9);
  new DataView(phys.buffer).setUint32(0, pixelsPerMeter);
  new DataView(phys.buffer).setUint32(4, pixelsPerMeter);
  phys[8] = 1;
  const physChunk = chunk('pHYs', phys);

  const parts: Uint8Array[] = [png.subarray(0, 8)];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let inserted = false;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const end = offset + 12 + length;
    if (type === 'pHYs') {
      offset = end;
      continue;
    }
    if (type === 'IDAT' && !inserted) {
      parts.push(physChunk);
      inserted = true;
    }
    parts.push(png.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  if (!inserted) return dataUrl;

  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  let encoded = '';
  for (let i = 0; i < out.length; i += 0x8000) {
    encoded += String.fromCharCode(...out.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(encoded)}`;
}
