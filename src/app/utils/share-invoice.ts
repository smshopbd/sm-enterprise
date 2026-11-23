import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';

async function whenFontsReady(timeoutMs = 4000): Promise<void> {
  const ready = document.fonts.ready.then(() => undefined);
  await Promise.race([ready, new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);
}

/**
 * Captures the slip/invoice element as it looks on screen (the preview transform is
 * dropped for the shot), with the same white-paper look the print flow produces.
 */
export async function captureInvoiceJpeg(el: HTMLElement): Promise<string> {
  const previousTransform = el.style.transform;
  el.style.transform = 'none';
  const options = { quality: 0.96, backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: false };
  try {
    await whenFontsReady();
    try {
      return await htmlToImage.toJpeg(el, options);
    } catch (err) {
      console.warn('Capture with embedded fonts failed, retrying without fonts...', err);
      return await htmlToImage.toJpeg(el, { ...options, skipFonts: true });
    }
  } finally {
    el.style.transform = previousTransform;
  }
}

export function buildJpegPdf(jpegDataUrl: string, widthMm: number, heightMm: number): jsPDF {
  return buildJpegPdfFromPages([jpegDataUrl], widthMm, heightMm);
}

/** One PDF page per captured sheet, so a long invoice is shared in full. */
export function buildJpegPdfFromPages(jpegs: string[], widthMm: number, heightMm: number): jsPDF {
  const orientation = heightMm >= widthMm ? 'portrait' : 'landscape';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [widthMm, heightMm] });
  jpegs.forEach((jpeg, index) => {
    if (index > 0) pdf.addPage([widthMm, heightMm], orientation);
    pdf.addImage(jpeg, 'JPEG', 0, 0, widthMm, heightMm);
  });
  return pdf;
}

/** Stitches long-invoice pages into one tall image for social-app image sharing. */
export async function stitchJpegsVertically(dataUrls: string[]): Promise<string> {
  if (dataUrls.length <= 1) return dataUrls[0] ?? '';
  const images = await Promise.all(dataUrls.map(src => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load a captured page.'));
    img.src = src;
  })));
  const width = Math.max(...images.map(img => img.width));
  const height = images.reduce((sum, img) => sum + img.height, 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrls[0];
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const img of images) {
    ctx.drawImage(img, 0, y, img.width, img.height);
    y += img.height;
  }
  return canvas.toDataURL('image/jpeg', 0.92);
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'unavailable';

export async function copyImageToClipboard(file: File): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]);
    return true;
  } catch {
    return false;
  }
}

/** Chrome/Safari only accept PNG on the async clipboard, so re-encode before retrying. */
async function toPngFile(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' }) : null;
  } catch {
    return null;
  }
}

export async function copyImageFile(file: File): Promise<boolean> {
  if (await copyImageToClipboard(file)) return true;
  if (file.type === 'image/png') return false;
  const png = await toPngFile(file);
  return png ? copyImageToClipboard(png) : false;
}

/** True when this exact file can go to the device share sheet. */
export function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return true;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** True when the browser can hand files to other apps (phones, tablets, some desktops). */
export function canShareFiles(): boolean {
  return canShareFile(new File(['x'], 'invoice.pdf', { type: 'application/pdf' }));
}

/** WhatsApp's own link: opens the app / WhatsApp Web with the message ready to send. */
export function openWhatsApp(text: string): boolean {
  return !!window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

/**
 * Hands the file to the OS share sheet — every social app on the phone appears
 * there. Never downloads on its own: when the browser has no share sheet the
 * image is copied to the clipboard, and otherwise the caller asks the user.
 */
export async function shareInvoiceFile(
  file: File,
  meta: { title: string; text: string }
): Promise<ShareOutcome> {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: meta.title, text: meta.text });
      return 'shared';
    } catch (err) {
      if ((err as DOMException | undefined)?.name === 'AbortError') return 'cancelled';
      console.warn('Web share failed, falling back', err);
    }
  }
  if (file.type.startsWith('image/') && (await copyImageFile(file))) return 'copied';
  return 'unavailable';
}
