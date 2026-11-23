import { Product, ProductVariant } from '../services/data';

const PARENT_FIELDS: ((p: Product) => string)[] = [
  p => p.name,
  p => p.code,
  p => p.rack,
  p => p.warehouse || '',
  p => p.slug || '',
  p => p.category,
  p => p.subCategory || '',
  p => p.brand,
  p => p.model,
  p => p.unit,
  p => p.type
];

/**
 * Imported and hand-edited rows can arrive with a missing or numeric field
 * (a sheet without a rack column, an old save missing a category). One such
 * record must not throw and blank the search for the whole catalog.
 */
function normalizeSearchText(raw: unknown): string {
  const value = raw == null ? '' : String(raw);
  if (!value) return '';
  const bengaliDigits = '০১২৩৪৫৬৭৮৯';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return value
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[০-৯]/g, digit => String(bengaliDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String(arabicDigits.indexOf(digit)))
    // "1,200" is one price, not two tokens — keep thousands separators glued.
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Each variant answers with its label, code and selling prices so price searches land on it. */
function variantFields(v: ProductVariant): string[] {
  return [
    v.variationName,
    v.variantValue,
    v.itemCode,
    String(v.salesPrice || ''),
    String(v.wholesalePrice || '')
  ];
}

function scoreSearchFields(query: string, fields: string[]): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const normalizedFields = fields.map(normalizeSearchText).filter(Boolean);
  const queryTokens = normalizedQuery.split(' ');
  let tokenScore = 0;

  for (const token of queryTokens) {
    // Numbers are prices and codes: 1500 must not fuzzy-match 1400.
    const numeric = /^\d+$/.test(token);
    let bestScore = 0;
    for (const field of normalizedFields) {
      if (field === token || field.split(' ').includes(token)) {
        bestScore = Math.max(bestScore, 12);
      } else if (field.includes(token)) {
        bestScore = Math.max(bestScore, 9);
      } else if (!numeric && field.split(' ').some(word => fuzzyWordMatch(token, word))) {
        bestScore = Math.max(bestScore, 5);
      }
    }
    if (!bestScore) return 0;
    tokenScore += bestScore;
  }

  let score = 20 + tokenScore;
  if (normalizedFields.some(field => field === normalizedQuery)) score += 1000;
  else if (normalizedFields.some(field => field.startsWith(normalizedQuery))) score += 500;
  else if (normalizedFields.some(field => field.includes(normalizedQuery))) score += 250;
  return score;
}

function fuzzyWordMatch(query: string, word: string): boolean {
  if (query.length < 4 || Math.abs(query.length - word.length) > 1) return false;

  let queryIndex = 0;
  let wordIndex = 0;
  let edits = 0;

  while (queryIndex < query.length && wordIndex < word.length) {
    if (query[queryIndex] === word[wordIndex]) {
      queryIndex++;
      wordIndex++;
      continue;
    }

    edits++;
    if (edits > 1) return false;

    if (query.length === word.length) {
      if (
        queryIndex + 1 < query.length &&
        query[queryIndex] === word[wordIndex + 1] &&
        query[queryIndex + 1] === word[wordIndex]
      ) {
        queryIndex += 2;
        wordIndex += 2;
      } else {
        queryIndex++;
        wordIndex++;
      }
    } else if (query.length > word.length) {
      queryIndex++;
    } else {
      wordIndex++;
    }
  }

  if (queryIndex < query.length || wordIndex < word.length) edits++;
  return edits <= 1;
}

/** Returns a relevance score for one product or one flattened product/variant option. */
export function productSearchScore(p: Product, query: string, variant?: ProductVariant): number {
  const fields = PARENT_FIELDS.map(get => get(p));
  if (variant) fields.push(...variantFields(variant));
  else for (const item of p.variants || []) fields.push(...variantFields(item));
  return scoreSearchFields(query, fields);
}

export interface ProductSearchEntry {
  product: Product;
  variant?: ProductVariant;
  score: number;
}

/**
 * Search rows for pickers and lists. A product that owns variants answers once
 * per variant, so each variant can be picked and priced on its own.
 */
export function searchProductEntries(products: Product[], query: string): ProductSearchEntry[] {
  if (!normalizeSearchText(query)) return [];
  const entries: ProductSearchEntry[] = [];

  for (const product of products) {
    const parentFields = PARENT_FIELDS.map(get => get(product));
    const parentScore = scoreSearchFields(query, parentFields);
    const variants = product.variants || [];

    if (!variants.length) {
      if (parentScore > 0) entries.push({ product, score: parentScore });
      continue;
    }

    const rows = variants.map((variant, index) => ({
      variant,
      index,
      variantScore: scoreSearchFields(query, variantFields(variant)),
      score: scoreSearchFields(query, [...parentFields, ...variantFields(variant)])
    }));
    const ownHits = rows.filter(row => row.variantScore > 0);
    // A variant-text hit lists only those variants; a parent-only hit lists them all.
    const listed = ownHits.length ? ownHits : (parentScore > 0 ? rows : rows.filter(row => row.score > 0));
    if (!listed.length) continue;

    const ordered = [...listed].sort((a, b) =>
      b.variantScore - a.variantScore || b.score - a.score || a.index - b.index);
    for (const row of ordered) entries.push({ product, variant: row.variant, score: row.score || parentScore });
  }

  // Stable sort keeps each product's own variant order while ranking products.
  return entries.sort((a, b) => b.score - a.score);
}

/** Search products and put exact, prefix and close matches ahead of looser matches. */
export function searchProducts(products: Product[], query: string): Product[] {
  if (!normalizeSearchText(query)) return [];
  return products
    .map((product, index) => ({ product, index, score: productSearchScore(product, query) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(result => result.product);
}

export function matchedVariants(p: Product, query: string): ProductVariant[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const parentFields = PARENT_FIELDS.map(get => get(p));
  const queryTokens = normalizedQuery.split(' ');
  return (p.variants || [])
    .map((variant, index) => {
      const fields = variantFields(variant);
      const score = scoreSearchFields(query, [...parentFields, ...fields]);
      const variantMatched = queryTokens.some(token =>
        scoreSearchFields(token, fields) > 0
      );
      return { variant, index, score, variantMatched };
    })
    .filter(result => result.score > 0 && result.variantMatched)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(result => result.variant);
}

/** A product matches when the parent fields or any of its variants match the query. */
export function matchesProductSearch(p: Product, query: string): boolean {
  if (!normalizeSearchText(query)) return true;
  return productSearchScore(p, query) > 0;
}

/** Parent (non-variant) fields only — used by flattened pickers. */
export function matchesParentFields(p: Product, query: string): boolean {
  if (!normalizeSearchText(query)) return true;
  return scoreSearchFields(query, PARENT_FIELDS.map(get => get(p))) > 0;
}

export function matchesVariantText(v: ProductVariant, query: string): boolean {
  if (!normalizeSearchText(query)) return false;
  return scoreSearchFields(query, variantFields(v)) > 0;
}

export function variantLabel(v: ProductVariant): string {
  return [v.variationName, v.variantValue].filter(Boolean).join(' · ');
}
