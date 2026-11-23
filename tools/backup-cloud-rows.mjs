import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = new Map();
for (const line of (await readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0 && !line.trim().startsWith('#')) env.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
}
const url = env.get('SUPABASE_URL');
const key = env.get('SUPABASE_ANON_KEY');
const pageSize = 1000;
const rows = [];
for (let from = 0; ; from += pageSize) {
  const response = await fetch(`${url}/rest/v1/sm_rows?select=collection,row_id,data&order=collection,row_id`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Range: `${from}-${from + pageSize - 1}`
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const page = await response.json();
  rows.push(...page);
  if (page.length < pageSize) break;
}
const out = path.join(root, 'backups', `supabase-rows-${new Date().toISOString().slice(0, 10)}.json`);
await writeFile(out, JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
const counts = {};
for (const row of rows) counts[row.collection] = (counts[row.collection] ?? 0) + 1;
console.log(`Backed up ${rows.length} rows to ${out}`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));
