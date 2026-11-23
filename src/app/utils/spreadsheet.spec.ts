import { vi } from 'vitest';
import { downloadWorkbook, parseCsvGrid, readSpreadsheetGrid } from './spreadsheet';

function bufferOf(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('spreadsheet utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('parses CSV quotes, escaped quotes, commas, CRLF and Bengali text', () => {
    const grid = parseCsvGrid('\uFEFFName,Qty,Note\r\n"পণ্য, এক",2,"লাইন ১\nলাইন ২"\r\nBattery,3,"6"" cell"\r\n');
    expect(grid).toEqual([
      ['Name', 'Qty', 'Note'],
      ['পণ্য, এক', '2', 'লাইন ১\nলাইন ২'],
      ['Battery', '3', '6" cell']
    ]);
  });

  it('reads a Bengali CSV File without mangling Unicode', async () => {
    const file = new File(['Name,Price\nপণ্য,১২৫\n'], 'products.csv', { type: 'text/csv' });
    await expect(readSpreadsheetGrid(file)).resolves.toEqual([['Name', 'Price'], ['পণ্য', '১২৫']]);
  });

  it('writes multiple xlsx sheets with headers and values, then reads them back', async () => {
    let blob: Blob | undefined;
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = vi.fn((value: Blob) => {
        blob = value;
        return 'blob:spreadsheet-test';
      });
      static override revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await downloadWorkbook('report.xlsx', [
      { name: 'Summary', rows: [{ Metric: 'বিক্রয়', Value: 1250 }, { Metric: 'লাভ', Value: 300 }] },
      { name: 'Stock', rows: [{ Product: 'ব্যাটারি', Stock: 4 }] }
    ]);

    expect(blob).toBeDefined();
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    await workbook.xlsx.load(await bufferOf(blob!));
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Summary', 'Stock']);
    expect(workbook.getWorksheet('Summary')!.getCell('A1').value).toBe('Metric');
    expect(workbook.getWorksheet('Summary')!.getCell('A2').value).toBe('বিক্রয়');
    expect(workbook.getWorksheet('Summary')!.getCell('B3').value).toBe(300);

    const file = new File([blob!], 'report.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await expect(readSpreadsheetGrid(file)).resolves.toEqual([
      ['Metric', 'Value'],
      ['বিক্রয়', '1250'],
      ['লাভ', '300']
    ]);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });
});