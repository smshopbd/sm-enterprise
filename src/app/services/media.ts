import { Injectable, inject, signal } from '@angular/core';
import { PreferencesService } from './preferences';
import { StorageService, type MediaRecord } from './storage';
import { CloudService } from './cloud';

export interface PreparedImage {
  /** what gets stored on the record: Cloudinary URL, or a data URL while offline */
  ref: string;
  mediaId: string;
  width: number;
  height: number;
  bytes: number;
  remote: boolean;
  note?: string;
}

export type PickResult = { ok: true; image: PreparedImage } | { ok: false; error?: string };

/** Product pictures only ever need to be this big — heavy uploads get shrunk. */
export const IMAGE_MAX_PX = 400;
export const IMAGE_MAX_BYTES = 60_000;

/**
 * File-picker filter for every catalogue image field. `image/*` alone hides
 * formats on some Android/Windows pickers, so the extensions are listed too.
 * Whatever the browser can decode is re-encoded to JPEG before storage.
 */
export const IMAGE_ACCEPT = 'image/*,.jpg,.jpeg,.jfif,.png,.apng,.gif,.webp,.bmp,.avif,.heic,.heif,.svg,.ico,.tif,.tiff';
const IMAGE_EXT = /\.(jpe?g|jfif|png|apng|gif|webp|bmp|avif|hei[cf]|svg|ico|tiff?)$/i;

/** Signatures are printed larger, so they keep more pixels. */
export const SIGNATURE_LIMITS = { maxPx: 600, maxBytes: 200_000 };

export interface ImageLimits {
  maxPx: number;
  maxBytes: number;
}

const DEFAULT_LIMITS: ImageLimits = { maxPx: IMAGE_MAX_PX, maxBytes: IMAGE_MAX_BYTES };

@Injectable({ providedIn: 'root' })
export class MediaService {
  private storage = inject(StorageService);
  private cloud = inject(CloudService);
  private prefs = inject(PreferencesService);

  readonly lastUpload = signal<PreparedImage | null>(null);
  readonly busy = signal(false);

  /**
   * Shared `<input type=file>` handling: validates the pick, shrinks it, and sends it to
   * Cloudinary when that is configured, so image bytes never travel in the data rows.
   */
  async pick(e: Event, subfolder: string, nameHint: string, maxMb = 10, limits: ImageLimits = DEFAULT_LIMITS): Promise<PickResult> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return { ok: false };
    // Some Android file managers report an empty MIME type; fall back to the name.
    if (!file.type.startsWith('image/') && !IMAGE_EXT.test(file.name)) {
      return { ok: false, error: this.prefs.txt('সঠিক ছবি ফাইল নির্বাচন করুন।', 'Please select a valid image file.') };
    }
    if (file.size > maxMb * 1024 * 1024) {
      return { ok: false, error: this.prefs.txt(`ছবির সাইজ ${maxMb} MB বা তার কম হতে হবে।`, `Image must be ${maxMb} MB or smaller.`) };
    }
    try {
      return { ok: true, image: await this.prepare(file, subfolder, nameHint, limits) };
    } catch {
      // Browsers cannot decode HEIC/HEIF inside a canvas — say so instead of a dead end.
      if (/hei[cf]/i.test(file.type) || /\.(hei[cf])$/i.test(file.name)) {
        return {
          ok: false,
          error: this.prefs.txt(
            'HEIC/HEIF (iPhone) ছবি ব্রাউজার পড়তে পারে না — ফোন থেকে JPG হিসেবে শেয়ার/সেভ করে আবার চেষ্টা করুন।',
            'HEIC/HEIF photos cannot be read by the browser — share or save them as JPG and try again.'
          )
        };
      }
      return {
        ok: false,
        error: this.prefs.txt(
          'ব্রাউজার এই ছবিটি পড়তে পারেনি — JPG/PNG ফরম্যাটে সেভ করে আবার চেষ্টা করুন।',
          'The browser could not read that image — save it as JPG/PNG and try again.'
        )
      };
    }
  }

  /** Resize + recompress, then push to Cloudinary when it is configured. */
  async prepare(file: File | Blob, subfolder: string, nameHint: string, limits: ImageLimits = DEFAULT_LIMITS): Promise<PreparedImage> {
    this.busy.set(true);
    try {
      const shrunk = await this.compress(file, limits);
      const mediaId = `${subfolder}-${sanitize(nameHint)}-${Date.now().toString(36)}`;
      const record: MediaRecord = {
        id: mediaId,
        blob: shrunk.blob,
        contentType: shrunk.blob.type || 'image/jpeg',
        bytes: shrunk.blob.size,
        width: shrunk.width,
        height: shrunk.height,
        createdAt: new Date().toISOString()
      };
      await this.storage.putMedia(record);

      if (this.cloud.isCloudinaryEnabled()) {
        try {
          const uploaded = await this.cloud.uploadImage(shrunk.blob, subfolder, mediaId);
          await this.storage.putMedia({ ...record, remoteUrl: uploaded.secureUrl });
          const prepared: PreparedImage = {
            ref: uploaded.secureUrl,
            mediaId,
            width: shrunk.width,
            height: shrunk.height,
            bytes: shrunk.blob.size,
            remote: true
          };
          this.lastUpload.set(prepared);
          return prepared;
        } catch (error) {
          const note = error instanceof Error ? error.message : String(error);
          const prepared: PreparedImage = {
            ref: await toDataUrl(shrunk.blob),
            mediaId,
            width: shrunk.width,
            height: shrunk.height,
            bytes: shrunk.blob.size,
            remote: false,
            note: `Cloudinary আপলোড হয়নি (${this.cloud.cloudinaryShort(note)}) — ছবি ডিভাইসে সেভ হয়েছে।`
          };
          this.lastUpload.set(prepared);
          return prepared;
        }
      }
      const prepared: PreparedImage = {
        ref: await toDataUrl(shrunk.blob),
        mediaId,
        width: shrunk.width,
        height: shrunk.height,
        bytes: shrunk.blob.size,
        remote: false
      };
      this.lastUpload.set(prepared);
      return prepared;
    } finally {
      this.busy.set(false);
    }
  }

  /** Canvas fit inside limits.maxPx, JPEG quality ladder down to the byte cap. */
  async compress(file: File | Blob, limits: ImageLimits = DEFAULT_LIMITS): Promise<{ blob: Blob; width: number; height: number }> {
    const bitmap = await readImage(file);
    const scale = Math.min(1, limits.maxPx / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));

    let best: Blob | undefined;
    let bestWidth = width;
    let bestHeight = height;
    for (let round = 0; round < 4; round++) {
      const canvas = draw(bitmap, width, height);
      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        const blob = await canvasToBlob(canvas, quality);
        if (!best || blob.size < best.size) {
          best = blob;
          bestWidth = width;
          bestHeight = height;
        }
        if (blob.size <= limits.maxBytes) {
          close(bitmap);
          return { blob, width, height };
        }
      }
      width = Math.max(120, Math.round(width * 0.8));
      height = Math.max(120, Math.round(height * 0.8));
    }
    close(bitmap);
    return { blob: best ?? file, width: bestWidth, height: bestHeight };
  }

  /**
   * Turns any stored reference back into something an <img> can show.
   * Remote Cloudinary URLs are cached in IndexedDB after the first download,
   * so reopening the catalog never re-fetches the same picture.
   */
  async resolve(ref: string | undefined | null): Promise<string | null> {
    if (!ref) return null;
    if (ref.startsWith('media:')) {
      const url = await this.storage.mediaUrl(ref.slice('media:'.length));
      return url;
    }
    if (/^https?:\/\//i.test(ref)) {
      return this.resolveRemote(ref);
    }
    return ref;
  }

  private remoteCache = new Map<string, Promise<string | null>>();

  private resolveRemote(url: string): Promise<string | null> {
    let pending = this.remoteCache.get(url);
    if (!pending) {
      pending = this.fetchRemoteCached(url);
      this.remoteCache.set(url, pending);
    }
    return pending;
  }

  private async fetchRemoteCached(url: string): Promise<string | null> {
    const id = `remote-${this.hash(url)}`;
    try {
      const cached = await this.storage.getMedia(id);
      if (cached?.blob) return this.storage.mediaUrl(id);
      const response = await fetch(url);
      if (!response.ok) return url;
      const blob = await response.blob();
      try {
        await this.storage.putMedia({
          id,
          blob,
          contentType: blob.type || 'image/jpeg',
          bytes: blob.size,
          width: 0,
          height: 0,
          createdAt: new Date().toISOString(),
          remoteUrl: url
        });
        return this.storage.mediaUrl(id);
      } catch {
        return URL.createObjectURL(blob);
      }
    } catch {
      // Offline or storage full — let the <img> load the URL directly.
      return url;
    }
  }

  private hash(value: string): string {
    let h = 0;
    for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}

async function readImage(file: File | Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in globalThis) {
    try {
      return await createImageBitmap(file as Blob);
    } catch {
      /* fall through to the <img> decoder */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('ছবি পড়া যায়নি'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  return img;
}

function draw(source: ImageBitmap | HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ক্যানভাস পাওয়া যায়নি');
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no alpha; white keeps transparent logos from turning black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('কমপ্রেশন ব্যর্থ'))), 'image/jpeg', quality);
  });
}

function close(bitmap: ImageBitmap | HTMLImageElement): void {
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('ডাটা ইউআরএল হয়নি'));
    reader.readAsDataURL(blob);
  });
}

function sanitize(value: string): string {
  return (value || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'image';
}
