import type { CellValue } from 'exceljs';

export interface SpreadsheetSheet {
  name: string;
  rows: Record<string, unknown>[];
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ExcelJsModule = typeof import('exceljs');

/** Production bundles expose the CJS build as `default`; dev also has named exports. */
async function loadExcelJs(): Promise<ExcelJsModule> {
  const module = await import('exceljs');
  const fallback = (module as unknown as { default?: ExcelJsModule }).default;
  return fallback?.Workbook ? fallback : module;
}

export async function downloadWorkbook(filename: string, sheets: SpreadsheetSheet[]): Promise<void> {
  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    const headers: string[] = [];
    for (const row of sheet.rows) {
      for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key);
    }
    if (!headers.length) continue;
    worksheet.columns = headers.map(header => ({
      header,
      key: header,
      width: Math.min(42, Math.max(12, header.length + 2))
    }));
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of sheet.rows) {
      worksheet.addRow(Object.fromEntries(headers.map(header => [header, cellValue(row[header])])));
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

export async function readSpreadsheetGrid(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    return parseCsvGrid(await readText(file));
  }
  const { Workbook } = await loadExcelJs();
  const workbook = new Workbook();
  await workbook.xlsx.load(await readBuffer(file));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const grid: string[][] = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= worksheet.columnCount; c++) cells.push(row.getCell(c).text);
    grid.push(cells);
  }
  return grid;
}

/** Older Safari builds expose FileReader but not File.text()/arrayBuffer(). */
function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('file-read-failed'));
    reader.readAsText(file, 'utf-8');
  });
}

function readBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('file-read-failed'));
    reader.readAsArrayBuffer(file);
  });
}

/** Quoted commas and newlines are data; doubled quotes are one literal quote. */
export function parseCsvGrid(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && source[i + 1] === '\n') i++;
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}