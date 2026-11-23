/**
 * Printing for the 80 mm POS slip (POS checkout receipt and the sales-list
 * "POS Invoice"). A short slip keeps the old single A4 sheet at the top of the
 * page; a long bill is measured and split into several A4 sheets, each with the
 * shop header repeated, so nothing is shrunk or cut off.
 */

export interface ReceiptPagePlan {
  /** Indexes into the measured item rows. */
  rows: number[];
  /** Indexes into the measured tail blocks (battery, totals, notes, QR…). */
  tail: number[];
}

export interface ReceiptPlanInput {
  rowHeights: number[];
  tailHeights: number[];
  /** Page 1: letterhead + buyer info + table header. */
  firstFixed: number;
  /** Later pages with rows: continuation header + table header. */
  contFixed: number;
  /** A page that only carries tail blocks. */
  contHeadOnly: number;
  pageHeight: number;
}

export function planReceiptPages(input: ReceiptPlanInput): ReceiptPagePlan[] {
  const pages: ReceiptPagePlan[] = [{ rows: [], tail: [] }];
  const used: number[] = [input.firstFixed];
  let current = 0;

  for (let i = 0; i < input.rowHeights.length; i++) {
    const height = input.rowHeights[i];
    if (pages[current].rows.length && used[current] + height > input.pageHeight) {
      pages.push({ rows: [], tail: [] });
      used.push(input.contFixed);
      current++;
    }
    pages[current].rows.push(i);
    used[current] += height;
  }

  for (let i = 0; i < input.tailHeights.length; i++) {
    const height = input.tailHeights[i];
    if (used[current] + height > input.pageHeight) {
      pages.push({ rows: [], tail: [] });
      used.push(input.contHeadOnly);
      current++;
    }
    pages[current].tail.push(i);
    used[current] += height;
  }

  return pages;
}

const MM_TO_PX = 96 / 25.4;
/** The tallest a slip may get on one A4 sheet (296 mm), leaving a small margin. */
const PAPER_TARGET_PX = Math.floor(280 * MM_TO_PX);
/** Up to this height the slip stays a single sheet, exactly as it always printed. */
const SINGLE_PAGE_MAX_PX = PAPER_TARGET_PX;

interface ReceiptParts {
  head?: HTMLElement;
  meta?: HTMLElement;
  items?: HTMLTableElement;
  tail: HTMLElement[];
}

function partsOf(paper: HTMLElement): ReceiptParts {
  const items = paper.querySelector<HTMLTableElement>('[data-pos="items"]') ?? undefined;
  const head = paper.querySelector<HTMLElement>('[data-pos="head"]') ?? undefined;
  const meta = paper.querySelector<HTMLElement>('[data-pos="meta"]') ?? undefined;
  const tail = Array.from(paper.querySelectorAll<HTMLElement>(
    '[data-pos="extra"], [data-pos="summary"], [data-pos="footer"], [data-pos="notes"], [data-pos="qr"]'
  ));
  return { head, meta, items, tail };
}

function outerHeight(el: Element): number {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const top = Number.parseFloat(style.marginTop) || 0;
  const bottom = Number.parseFloat(style.marginBottom) || 0;
  return rect.height + top + bottom;
}

function clonePaperShell(source: HTMLElement): HTMLElement {
  const paper = document.createElement('div');
  paper.className = source.className;
  paper.classList.add('pos-print-paper');
  if (source.getAttribute('style')) paper.setAttribute('style', source.getAttribute('style') ?? '');
  return paper;
}

function sheetFor(paper: HTMLElement): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'pos-print-sheet';
  sheet.appendChild(paper);
  return sheet;
}

function continuationHeader(source: HTMLElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'text-center border-b border-dashed border-slate-400 pb-2';
  const shop = document.createElement('p');
  shop.className = 'font-black text-sm tracking-wide';
  shop.textContent = source.dataset['posShop'] || '';
  const doc = document.createElement('p');
  doc.className = 'font-black text-[11px] mt-1 uppercase tracking-wider';
  doc.textContent = [source.dataset['posDoc'], source.dataset['posContinued']].filter(Boolean).join(' — ');
  const invoice = document.createElement('p');
  invoice.className = 'text-[10px] font-mono';
  invoice.textContent = source.dataset['posInvoice'] || '';
  const children = [shop];
  if (doc.textContent) children.push(doc);
  if (invoice.textContent) children.push(invoice);
  box.append(...children);
  return box;
}

function buildRowsTable(source: HTMLTableElement, rows: HTMLTableRowElement[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = source.className;
  const head = source.querySelector('thead');
  if (head) table.appendChild(head.cloneNode(true));
  const body = document.createElement('tbody');
  for (const row of rows) body.appendChild(row.cloneNode(true));
  table.appendChild(body);
  return table;
}

function pageNumberLine(word: string, text: string): HTMLElement {
  const line = document.createElement('p');
  line.className = 'text-[9px] text-center text-slate-500 mt-2';
  line.textContent = `${word} ${text}`;
  return line;
}

export function printPosReceipt(source: HTMLElement | null): void {
  if (!source) return;

  document.getElementById('pos-print-root')?.remove();
  document.body.classList.remove('printing-pos-receipt');

  const root = document.createElement('div');
  root.id = 'pos-print-root';
  document.body.appendChild(root);

  // Measure a hidden clone at the real 80 mm paper width.
  const measurePaper = source.cloneNode(true) as HTMLElement;
  measurePaper.removeAttribute('id');
  measurePaper.classList.add('pos-print-paper');
  const measureSheet = sheetFor(measurePaper);
  root.appendChild(measureSheet);

  const paperHeight = measurePaper.getBoundingClientRect().height;
  const oneSheet = paperHeight <= SINGLE_PAGE_MAX_PX;

  if (oneSheet) {
    document.body.classList.add('printing-pos-receipt');
    printRoot(root);
    return;
  }

  const parts = partsOf(measurePaper);
  const table = parts.items;
  const tbody = table?.querySelector('tbody');
  const rows = tbody ? Array.from(tbody.rows) : [];
  const tableHead = table?.querySelector('thead');
  const tableTop = table ? (Number.parseFloat(getComputedStyle(table).marginTop) || 0) : 0;
  const headFixed = (parts.head ? outerHeight(parts.head) : 0)
    + (parts.meta ? outerHeight(parts.meta) : 0)
    + tableTop
    + (tableHead ? outerHeight(tableHead) : 0);
  const fixed = parts.head || parts.meta ? headFixed : (tableHead ? outerHeight(tableHead) : 0);
  const rowHeights = rows.map(row => outerHeight(row));
  const tailHeights = parts.tail.map(block => outerHeight(block));

  // A continuation header adds its own height to every later page.
  measurePaper.appendChild(continuationHeader(source));
  const contHeaderHeight = outerHeight(measurePaper.lastElementChild as Element);
  measurePaper.removeChild(measurePaper.lastElementChild as Element);

  // The paper's own 4 mm padding and the page-number line also take room, so
  // the rows must fit in what is left of the sheet.
  const paperStyle = getComputedStyle(measurePaper);
  const paperPadding = (Number.parseFloat(paperStyle.paddingTop) || 0)
    + (Number.parseFloat(paperStyle.paddingBottom) || 0);
  const pageWord = source.dataset['posPageWord'] || 'Page';
  const numberProbe = pageNumberLine(pageWord, '1/1');
  measurePaper.appendChild(numberProbe);
  const pageNumberHeight = outerHeight(numberProbe);
  measurePaper.removeChild(numberProbe);
  const pageHeight = Math.max(400, PAPER_TARGET_PX - paperPadding - pageNumberHeight);

  const pages = planReceiptPages({
    rowHeights,
    tailHeights,
    firstFixed: fixed,
    contFixed: contHeaderHeight + tableTop + (tableHead ? outerHeight(tableHead) : 0),
    contHeadOnly: contHeaderHeight,
    pageHeight
  });

  root.removeChild(measureSheet);
  const total = pages.length;

  pages.forEach((page, index) => {
    const paper = clonePaperShell(source);
    if (index === 0) {
      if (parts.head) paper.appendChild(parts.head.cloneNode(true));
      if (parts.meta) paper.appendChild(parts.meta.cloneNode(true));
    } else {
      paper.appendChild(continuationHeader(source));
    }
    if (table && rows.length && page.rows.length) {
      const pageRows = page.rows.map(i => rows[i]);
      paper.appendChild(buildRowsTable(table, pageRows));
    }
    for (const tailIndex of page.tail) {
      paper.appendChild(parts.tail[tailIndex].cloneNode(true));
    }
    paper.appendChild(pageNumberLine(pageWord, `${index + 1}/${total}`));
    root.appendChild(sheetFor(paper));
  });

  document.body.classList.add('printing-pos-receipt');
  printRoot(root);
}

function printRoot(root: HTMLElement): void {
  const pageStyleId = 'pos-receipt-page-size';
  const pageStyle = document.createElement('style');
  pageStyle.id = pageStyleId;
  pageStyle.textContent = '@page { size: A4 portrait; margin: 0; }';
  document.head.appendChild(pageStyle);

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    document.body.classList.remove('printing-pos-receipt');
    root.remove();
    document.getElementById(pageStyleId)?.remove();
  };
  window.addEventListener('afterprint', cleanup);

  setTimeout(() => {
    window.print();
    // Kiosk and older browsers may never fire afterprint; clear it regardless.
    setTimeout(cleanup, 60_000);
  }, 80);
}
