import { describe, expect, it } from 'vitest';
import { pngWithDpi } from './png-dpi';

// 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function chunks(dataUrl: string): { type: string; data: Uint8Array }[] {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out: { type: string; data: Uint8Array }[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    out.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return out;
}

describe('pngWithDpi', () => {
  it('inserts a 300 DPI pHYs chunk before the image data', () => {
    const tagged = pngWithDpi(PNG, 300);
    const list = chunks(tagged);
    const index = list.findIndex(c => c.type === 'pHYs');
    expect(index).toBeGreaterThan(-1);
    expect(index).toBeLessThan(list.findIndex(c => c.type === 'IDAT'));
    const view = new DataView(list[index].data.buffer, list[index].data.byteOffset, list[index].data.byteLength);
    expect(view.getUint32(0)).toBe(11811);
    expect(view.getUint32(4)).toBe(11811);
    expect(list[index].data[8]).toBe(1);
  });

  it('replaces an existing pHYs chunk instead of duplicating it', () => {
    const once = pngWithDpi(PNG, 300);
    const twice = pngWithDpi(once, 600);
    const phys = chunks(twice).filter(c => c.type === 'pHYs');
    expect(phys).toHaveLength(1);
    const view = new DataView(phys[0].data.buffer, phys[0].data.byteOffset, phys[0].data.byteLength);
    expect(view.getUint32(0)).toBe(23622);
  });

  it('leaves non-PNG and malformed input untouched', () => {
    expect(pngWithDpi('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(pngWithDpi('not-a-data-url')).toBe('not-a-data-url');
  });
});
