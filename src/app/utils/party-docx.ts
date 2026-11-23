import { localDateIso } from './local-date';
import { saveBlob } from './voucher-print';

export interface PartyDocxRow {
  sl: number;
  name: string;
  company: string;
  roles: string;
  phone: string;
  address: string;
  total: number;
  paid: number;
  due: number;
}

export interface PartyDocxMeta {
  title: string;
  scope: string;
  search: string;
  sort: string;
  dueLabel: string;
  generated: string;
  totals: { total: number; paid: number; due: number };
  shop: { name: string; address: string; mobile: string; email: string };
}

export const PARTY_DOCX_ACCENT = '087D6C';

export function partyDocxFileName(): string {
  return `Party-List-${localDateIso()}.docx`;
}

function money(value: number): string {
  return (Math.round((Number(value) || 0) * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function text(value: string | undefined, fallback = '—'): string {
  const trimmed = (value || '').trim();
  return trimmed || fallback;
}

const COLUMN_WIDTHS = [500, 2300, 1300, 1300, 2066, 1000, 1000, 1000];
const HEADERS = ['#', 'নাম', 'ধরন', 'মোবাইল', 'ঠিকানা', 'মোট', 'পরিশোধিত', ''];

export async function partyDocxBlob(rows: readonly PartyDocxRow[], meta: PartyDocxMeta): Promise<Blob> {
  const {
    AlignmentType, BorderStyle, Document, Footer, Packer, PageNumber, Paragraph, ShadingType,
    Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType
  } = await import('docx');

  const font = 'Nirmala UI';
  const border = { style: BorderStyle.SINGLE, size: 4, color: '8FA0A6' };
  const cellMargins = { top: 40, bottom: 40, left: 80, right: 80 };
  const numeral = (textValue: string, bold = false, color = '0F172A', size = 18) =>
    new TextRun({ text: textValue, bold, color, size, font });

  const headerCells = HEADERS.map((label, index) => new TableCell({
    width: { size: COLUMN_WIDTHS[index], type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: PARTY_DOCX_ACCENT },
    margins: cellMargins,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: index >= 5 ? AlignmentType.RIGHT : index === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 0, after: 0 },
      children: [new TextRun({
        text: index === 7 ? meta.dueLabel : label,
        bold: true,
        color: 'FFFFFF',
        size: 17,
        font
      })]
    })]
  }));

  const bodyRows = rows.map((row, index) => {
    const zebra = index % 2 === 1 ? 'F6F8F8' : undefined;
    const cell = (children: InstanceType<typeof Paragraph>[], align: typeof AlignmentType[keyof typeof AlignmentType], width: number) =>
      new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: zebra ? { type: ShadingType.CLEAR, color: 'auto', fill: zebra } : undefined,
        margins: cellMargins,
        verticalAlign: VerticalAlign.CENTER,
        children
      });
    const line = (value: string, align: typeof AlignmentType[keyof typeof AlignmentType], options: { bold?: boolean; color?: string; size?: number } = {}) =>
      new Paragraph({
        alignment: align,
        spacing: { before: 0, after: 0 },
        children: [numeral(value, options.bold, options.color, options.size)]
      });
    const dueColor = row.due > 0 ? '9B1C15' : row.due < 0 ? '0B5F3D' : '0F172A';

    return new TableRow({
      children: [
        cell([line(String(row.sl), AlignmentType.CENTER)], AlignmentType.CENTER, COLUMN_WIDTHS[0]),
        cell([
          line(text(row.name), AlignmentType.LEFT, { bold: true }),
          ...(row.company ? [line(row.company, AlignmentType.LEFT, { color: '3F4F56', size: 16 })] : [])
        ], AlignmentType.LEFT, COLUMN_WIDTHS[1]),
        cell([line(text(row.roles), AlignmentType.LEFT)], AlignmentType.LEFT, COLUMN_WIDTHS[2]),
        cell([line(text(row.phone), AlignmentType.LEFT)], AlignmentType.LEFT, COLUMN_WIDTHS[3]),
        cell([line(text(row.address), AlignmentType.LEFT)], AlignmentType.LEFT, COLUMN_WIDTHS[4]),
        cell([line(money(row.total), AlignmentType.RIGHT)], AlignmentType.RIGHT, COLUMN_WIDTHS[5]),
        cell([line(money(row.paid), AlignmentType.RIGHT)], AlignmentType.RIGHT, COLUMN_WIDTHS[6]),
        cell([line(money(row.due), AlignmentType.RIGHT, { bold: true, color: dueColor })], AlignmentType.RIGHT, COLUMN_WIDTHS[7])
      ]
    });
  });

  const totalRow = new TableRow({
    tableHeader: false,
    children: [
      new TableCell({
        columnSpan: 5,
        width: { size: COLUMN_WIDTHS.slice(0, 5).reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E6EDEC' },
        margins: cellMargins,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [numeral(`মোট ${rows.length} পার্টি`, true, '1F2D33')]
        })]
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[5], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E6EDEC' },
        margins: cellMargins,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 0, after: 0 },
          children: [numeral(money(meta.totals.total), true)]
        })]
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[6], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E6EDEC' },
        margins: cellMargins,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 0, after: 0 },
          children: [numeral(money(meta.totals.paid), true)]
        })]
      }),
      new TableCell({
        width: { size: COLUMN_WIDTHS[7], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E6EDEC' },
        margins: cellMargins,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 0, after: 0 },
          children: [numeral(money(meta.totals.due), true, meta.totals.due > 0 ? '9B1C15' : '0F172A')]
        })]
      })
    ]
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: COLUMN_WIDTHS,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'C8D3D6' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'C8D3D6' }
    },
    rows: [new TableRow({ tableHeader: true, children: headerCells }), ...bodyRows, totalRow]
  });

  const metaParts = [
    meta.title,
    meta.scope,
    `সাজানো: ${meta.sort}`,
    meta.search ? `সার্চ: “${meta.search}”` : '',
    `তৈরি: ${meta.generated}`
  ].filter(Boolean).join('  ·  ');

  const children = [
    new Paragraph({
      spacing: { before: 0, after: 20 },
      children: [new TextRun({ text: meta.shop.name, bold: true, size: 32, color: PARTY_DOCX_ACCENT, font })]
    }),
    ...(meta.shop.address ? [new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: meta.shop.address, size: 18, color: '334155', font })]
    })] : []),
    ...(meta.shop.mobile || meta.shop.email ? [new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({
        text: [meta.shop.mobile, meta.shop.email].filter(Boolean).join('  ·  '),
        size: 18,
        color: '334155',
        font
      })]
    })] : []),
    new Paragraph({
      spacing: { before: 200, after: 40 },
      children: [new TextRun({ text: 'পার্টি তালিকা', bold: true, size: 26, color: '0F172A', font })]
    }),
    new Paragraph({
      spacing: { before: 0, after: 160 },
      children: [new TextRun({ text: metaParts, size: 16, color: '475659', font })]
    }),
    table
  ];

  const document = new Document({
    styles: {
      default: {
        document: { run: { font, size: 20 } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 720, bottom: 720, left: 720 }
        }
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({
              children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
              size: 16,
              color: '64748B',
              font
            })]
          })]
        })
      },
      children
    }]
  });

  return Packer.toBlob(document);
}

export async function downloadPartyDocx(rows: readonly PartyDocxRow[], meta: PartyDocxMeta): Promise<void> {
  const blob = await partyDocxBlob(rows, meta);
  saveBlob(blob, partyDocxFileName());
}
