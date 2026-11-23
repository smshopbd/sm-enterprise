const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

const seeds = [
  ['products', 'Product', 'DEMO_PRODUCTS'],
  ['categories', 'Category', 'DEMO_CATEGORIES'],
  ['subCategories', 'SubCategory', 'DEMO_SUB_CATEGORIES'],
  ['brands', 'Brand', 'DEMO_BRANDS'],
  ['productModels', 'ProductModel', 'DEMO_PRODUCT_MODELS'],
  ['variations', 'Variation', 'DEMO_VARIATIONS'],
];

for (const [name, type, constant] of seeds) {
  const start = src.indexOf(`readonly ${name} = signal<${type}[]>([`);
  if (start === -1) throw new Error(`seed not found: ${name}`);
  const open = start + `readonly ${name} = signal<${type}[]>([`.length;
  const end = src.indexOf('\n  ]);', open);
  if (end === -1) throw new Error(`seed end not found: ${name}`);
  const replacement = `readonly ${name} = signal<${type}[]>(${constant});`;
  src = src.slice(0, start) + replacement + src.slice(end + '\n  ]);'.length);
  console.log(`replaced seed: ${name}`);
}

for (const key of ['sm_products', 'sm_categories', 'sm_sub_categories', 'sm_brands', 'sm_product_models', 'sm_variations']) {
  src = src.split(`'${key}_v1'`).join(`'${key}_v2'`);
}

src = src.replace(
  "import { NotificationService } from './notification';",
  "import { NotificationService } from './notification';\n" +
  "import { DEMO_BRANDS, DEMO_CATEGORIES, DEMO_PRODUCTS, DEMO_PRODUCT_MODELS, DEMO_SUB_CATEGORIES, DEMO_VARIATIONS } from '../data/catalog-demo';"
);

fs.writeFileSync(file, src, 'utf8');
console.log('done');
