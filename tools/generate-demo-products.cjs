/**
 * Builds the app demo catalog from the two "Products Catalog" exports.
 * Usage: node tools/generate-demo-products.cjs <single.xlsx> <variable.xlsx>
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const [singlePath, variablePath] = process.argv.slice(2);
if (!singlePath || !variablePath) {
  console.error('Missing arguments: <single.xlsx> <variable.xlsx>');
  process.exit(1);
}

const HEADER_ROW = 3;

function readCatalog(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', range: HEADER_ROW });
  return rows.filter(r => {
    const code = String(r['Item Code / SKU'] ?? '').trim();
    const type = String(r['Product Type'] ?? '').trim();
    return code && type;
  });
}

const num = v => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const dash = v => {
  const s = String(v ?? '').trim();
  return s && s !== '—' && s !== '-' && s !== 'N/A' ? s : '';
};
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

const singles = readCatalog(singlePath).map(r => ({
  name: clean(r['Product Name']),
  code: String(r['Item Code / SKU']).trim(),
  category: dash(r['Category']) || 'অন্যান্য',
  subCategory: dash(r['Sub-Category']),
  brand: dash(r['Brand']) || 'Unknown',
  model: dash(r['Product Model']) || 'All Model',
  barcodeSymbology: dash(r['Barcode Symbology']) || 'CODE128',
  unit: dash(r['Unit']) || 'পিস',
  purchasePrice: num(r['Purchase Price (BDT)']) ?? 0,
  salesPrice: num(r['Sales Price (BDT)']) ?? 0,
  mrp: num(r['MRP (BDT)']),
  wholesalePrice: num(r['Wholesale Price (BDT)']) ?? 0,
  wholesaleQuantity: num(r['Wholesale Min Qty']),
  stock: num(r['Current Stock']) ?? 0,
  openingStock: num(r['Opening Stock']),
  minQty: num(r['Alert Quantity']),
  tax: num(r['Tax Rate (%)']),
  purchaseTaxMode: dash(r['Purchase Tax Type']),
  salesTaxMode: dash(r['Sales Tax Type']),
  rack: dash(r['Rack / Shelf No']),
  warehouse: dash(r['Warehouse']) || 'SM Warehouse',
  description: dash(r['Description']),
  createdAt: dash(r['Created Date']),
  image: dash(r['Image URL']),
}));

const variableRows = readCatalog(variablePath);

function parseVariantName(productName) {
  const m = /\[(.+?):\s*(.*)\]\s*$/.exec(clean(productName));
  if (m) return { variationName: clean(m[1]), variantValue: clean(m[2]) };
  return { variationName: 'Variant', variantValue: clean(productName) };
}

const variantsGrouped = [];
let current = null;
for (const r of variableRows) {
  const type = String(r['Product Type']).trim();
  if (type === 'Variable (Parent)') {
    const parentName = clean(r['Product Name']).replace(/\s*\[Parent Template.*?\]\s*$/i, '');
    current = {
      name: parentName,
      code: String(r['Item Code / SKU']).trim(),
      category: dash(r['Category']) || 'অন্যান্য',
      subCategory: dash(r['Sub-Category']),
      brand: dash(r['Brand']) || 'Unknown',
      model: dash(r['Product Model']) || 'All Model',
      barcodeSymbology: dash(r['Barcode Symbology']) || 'CODE128',
      unit: dash(r['Unit']) || 'পিস',
      warehouse: dash(r['Warehouse']) || 'SM Warehouse',
      rack: dash(r['Rack / Shelf No']),
      createdAt: dash(r['Created Date']),
      purchaseTaxMode: dash(r['Purchase Tax Type']),
      salesTaxMode: dash(r['Sales Tax Type']),
      tax: num(r['Tax Rate (%)']),
      mrp: num(r['MRP (BDT)']),
      wholesaleQuantity: num(r['Wholesale Min Qty']),
      variants: [],
    };
    variantsGrouped.push(current);
  } else if (current) {
    const { variationName, variantValue } = parseVariantName(r['Product Name']);
    current.variants.push({
      variationName,
      variantValue,
      itemCode: String(r['Item Code / SKU']).trim(),
      image: dash(r['Image URL']),
      quantityAlert: num(r['Alert Quantity']),
      mrp: num(r['MRP (BDT)']),
      tax: num(r['Tax Rate (%)']),
      purchasePrice: num(r['Purchase Price (BDT)']) ?? 0,
      purchaseTaxType: dash(r['Purchase Tax Type']),
      wholesalePrice: num(r['Wholesale Price (BDT)']) ?? 0,
      salesPrice: num(r['Sales Price (BDT)']) ?? 0,
      salesTaxType: dash(r['Sales Tax Type']),
      wholesaleQuantity: num(r['Wholesale Min Qty']),
      openingStock: num(r['Current Stock']) ?? 0,
      openingStockDate: dash(r['Created Date']),
    });
  }
}

// ---- assemble catalog -------------------------------------------------
let id = 0;
let variantId = 0;

const products = [
  ...singles.map(p => ({
    id: ++id,
    name: p.name,
    code: p.code,
    rack: p.rack,
    warehouse: p.warehouse,
    type: 'single',
    category: p.category,
    ...(p.subCategory ? { subCategory: p.subCategory } : {}),
    brand: p.brand,
    model: p.model,
    stock: p.stock,
    unit: p.unit,
    salesPrice: p.salesPrice,
    purchasePrice: p.purchasePrice,
    wholesalePrice: p.wholesalePrice,
    ...(p.image ? { image: p.image } : {}),
    barcodeSymbology: p.barcodeSymbology,
    ...(p.tax !== undefined ? { tax: p.tax } : {}),
    ...(p.openingStock !== undefined ? { openingStock: p.openingStock } : {}),
    ...(p.createdAt ? { openingStockDate: p.createdAt } : {}),
    ...(p.mrp !== undefined ? { mrp: p.mrp } : {}),
    ...(p.minQty !== undefined ? { minQty: p.minQty } : {}),
    ...(p.purchaseTaxMode ? { purchaseTaxMode: p.purchaseTaxMode } : {}),
    ...(p.salesTaxMode ? { salesTaxMode: p.salesTaxMode } : {}),
    ...(p.wholesaleQuantity !== undefined ? { wholesaleQuantity: p.wholesaleQuantity } : {}),
  })),
  ...variantsGrouped.map(g => {
    const first = g.variants[0] || {};
    const stock = g.variants.reduce((t, v) => t + (v.openingStock || 0), 0);
    return {
      id: ++id,
      name: g.name,
      code: g.code,
      rack: g.rack,
      warehouse: g.warehouse,
      type: 'variant',
      category: g.category,
      ...(g.subCategory ? { subCategory: g.subCategory } : {}),
      brand: g.brand,
      model: g.model,
      stock,
      unit: g.unit,
      salesPrice: first.salesPrice ?? 0,
      purchasePrice: first.purchasePrice ?? 0,
      wholesalePrice: first.wholesalePrice ?? 0,
      barcodeSymbology: g.barcodeSymbology,
      ...(g.tax !== undefined ? { tax: g.tax } : {}),
      ...(g.mrp !== undefined ? { mrp: g.mrp } : {}),
      ...(g.createdAt ? { openingStockDate: g.createdAt } : {}),
      ...(g.wholesaleQuantity !== undefined ? { wholesaleQuantity: g.wholesaleQuantity } : {}),
      variants: g.variants.map(v => ({
        id: ++variantId,
        variationId: 0,
        variationName: v.variationName,
        variantValue: v.variantValue,
        itemCode: v.itemCode,
        ...(v.image ? { image: v.image } : {}),
        ...(v.quantityAlert !== undefined ? { quantityAlert: v.quantityAlert } : {}),
        ...(v.mrp !== undefined ? { mrp: v.mrp } : {}),
        ...(v.tax !== undefined ? { tax: v.tax } : {}),
        purchasePrice: v.purchasePrice,
        ...(v.purchaseTaxType ? { purchaseTaxType: v.purchaseTaxType } : {}),
        wholesalePrice: v.wholesalePrice,
        salesPrice: v.salesPrice,
        ...(v.salesTaxType ? { salesTaxType: v.salesTaxType } : {}),
        ...(v.wholesaleQuantity !== undefined ? { wholesaleQuantity: v.wholesaleQuantity } : {}),
        openingStock: v.openingStock,
        ...(v.openingStockDate ? { openingStockDate: v.openingStockDate } : {}),
      })),
    };
  }),
];

// ---- taxonomy ---------------------------------------------------------
const slugify = s => clean(s).toLowerCase().replace(/[^\w\u0980-\u09FF]+/g, '-').replace(/^-+|-+$/g, '') || 'other';

const byKey = (items, keyFn) => {
  const map = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
};

const allForTaxonomy = [
  ...singles,
  ...variantsGrouped.map(g => ({ ...g, subCategory: g.subCategory, brand: g.brand, model: g.model, category: g.category })),
];

const categoryCount = byKey(allForTaxonomy, p => p.category);
const categories = [...categoryCount.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([name, count], i) => ({ id: i + 1, name, logo: '', productCount: count, status: 'Enabled' }));

const subPairs = new Map();
for (const p of allForTaxonomy) {
  if (!p.subCategory) continue;
  const key = `${p.category}||${p.subCategory}`;
  const entry = subPairs.get(key) || { name: p.subCategory, parentCategory: p.category, count: 0 };
  entry.count++;
  subPairs.set(key, entry);
}
const subCategories = [...subPairs.values()]
  .sort((a, b) => b.count - a.count)
  .map((e, i) => ({
    id: i + 1,
    name: e.name,
    slug: `${slugify(e.name)}-${slugify(e.parentCategory)}`.slice(0, 60),
    parentCategory: e.parentCategory,
    logo: '',
    productCount: e.count,
    status: 'Enabled',
  }));

const brandCount = byKey(allForTaxonomy, p => p.brand);
const brands = [...brandCount.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([name, count], i) => ({ id: i + 1, name, logo: '', productCount: count }));

const modelCount = byKey(allForTaxonomy, p => p.model);
const productModels = [...modelCount.keys()].sort().map((name, i) => ({ id: i + 1, name, logo: '' }));

const variationMap = new Map();
for (const g of variantsGrouped) {
  for (const v of g.variants) {
    const key = v.variationName;
    if (!variationMap.has(key)) variationMap.set(key, new Set());
    variationMap.get(key).add(v.variantValue);
  }
}
const variations = [...variationMap.entries()].map(([name, values], i) => ({
  id: i + 1,
  name,
  values: [...values].join(' '),
}));

// link variants to their variation definition
const variationIdByName = new Map(variations.map(v => [v.name, v.id]));
for (const p of products) {
  for (const v of p.variants || []) v.variationId = variationIdByName.get(v.variationName) || 0;
}

// ---- emit -------------------------------------------------------------
const rows = items => '[\n' + items.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]';

const out = `// AUTO-GENERATED by tools/generate-demo-products.cjs — do not edit by hand.
// Source: Products_SINGLE / Products_VARIABLE catalog exports (06 Nov 2026).
import type { Brand, Category, Product, ProductModel, SubCategory, Variation } from '../services/data';

export const DEMO_PRODUCTS: Product[] = ${rows(products)};

export const DEMO_CATEGORIES: Category[] = ${rows(categories)};

export const DEMO_SUB_CATEGORIES: SubCategory[] = ${rows(subCategories)};

export const DEMO_BRANDS: Brand[] = ${rows(brands)};

export const DEMO_PRODUCT_MODELS: ProductModel[] = ${rows(productModels)};

export const DEMO_VARIATIONS: Variation[] = ${rows(variations)};
`;

const dest = path.join(__dirname, '..', 'src', 'app', 'data', 'catalog-demo.ts');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf8');

const totalSkus = products.reduce((t, p) => t + 1 + (p.variants?.length || 0), 0);
console.log(`products=${products.length} (single=${singles.length}, variant parents=${variantsGrouped.length})`);
console.log(`variant items=${variantId} total skus=${totalSkus}`);
console.log(`categories=${categories.length} subCategories=${subCategories.length} brands=${brands.length} models=${productModels.length} variations=${variations.length}`);
console.log(`bytes=${fs.statSync(dest).size} -> ${dest}`);
