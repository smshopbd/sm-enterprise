import { buildJpegPdf, buildJpegPdfFromPages, canShareFiles, shareInvoiceFile } from './share-invoice';

const ONE_PIXEL_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

function defineNavigator(key: string, value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

describe('shareInvoiceFile', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'Invoice_1.pdf', { type: 'application/pdf' });

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>)['canShare'];
    delete (navigator as unknown as Record<string, unknown>)['share'];
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    vi.restoreAllMocks();
  });

  it('opens the device share sheet when files can be shared', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    defineNavigator('canShare', () => true);
    defineNavigator('share', share);

    await expect(shareInvoiceFile(file, { title: 'Invoice', text: 'Total 100' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      files: [file],
      title: 'Invoice',
      text: 'Total 100',
    }));
  });

  it('reports a cancelled share sheet without treating it as an error', async () => {
    defineNavigator('canShare', () => true);
    defineNavigator('share', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));

    await expect(shareInvoiceFile(file, { title: 'Invoice', text: '' })).resolves.toBe('cancelled');
  });

  it('uses the share sheet when canShare is missing but share exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    defineNavigator('share', share);

    await expect(shareInvoiceFile(file, { title: 'Invoice', text: 'Hi' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalled();
  });

  it('never downloads on its own — reports unavailable when the browser cannot share', async () => {
    defineNavigator('canShare', () => false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await expect(shareInvoiceFile(file, { title: 'Invoice', text: '' })).resolves.toBe('unavailable');
    expect(click).not.toHaveBeenCalled();
  });
});

describe('canShareFiles', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>)['canShare'];
    delete (navigator as unknown as Record<string, unknown>)['share'];
  });

  it('is false when the browser has no web share', () => {
    expect(canShareFiles()).toBe(false);
  });

  it('checks real file support through canShare', () => {
    defineNavigator('share', () => Promise.resolve());
    defineNavigator('canShare', () => true);
    expect(canShareFiles()).toBe(true);

    defineNavigator('canShare', () => false);
    expect(canShareFiles()).toBe(false);
  });
});

describe('buildJpegPdf', () => {
  it('lays the slip capture onto the requested paper size', () => {
    const pdf = buildJpegPdf(ONE_PIXEL_JPEG, 80, 160);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(80, 1);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(160, 1);
  });
});

describe('buildJpegPdfFromPages', () => {
  it('adds one PDF page per captured sheet for a long invoice', () => {
    const pdf = buildJpegPdfFromPages([ONE_PIXEL_JPEG, ONE_PIXEL_JPEG, ONE_PIXEL_JPEG], 210, 297);
    expect(pdf.getNumberOfPages()).toBe(3);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210, 1);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(297, 1);
  });
});
