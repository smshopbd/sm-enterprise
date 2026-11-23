import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = new Map();
for (const line of (await readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0 && !line.trim().startsWith('#')) env.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
}
const url = env.get('SUPABASE_URL');
const key = env.get('SUPABASE_ANON_KEY');
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function count() {
  const response = await fetch(`${url}/rest/v1/sm_rows?select=collection`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' }
  });
  if (!response.ok) throw new Error(`count HTTP ${response.status}: ${await response.text()}`);
  return response.headers.get('content-range')?.split('/')[1] ?? '?';
}

const before = await count();
console.log(`Rows before: ${before}`);

for (let attempt = 1; attempt <= 20; attempt++) {
  const response = await fetch(`${url}/rest/v1/sm_rows?collection=not.is.null`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal' }
  });
  if (!response.ok) throw new Error(`delete HTTP ${response.status}: ${await response.text()}`);
  const remaining = await count();
  console.log(`Delete pass ${attempt}: remaining ${remaining}`);
  if (remaining === '0') break;
}

const after = await count();
console.log(`Rows after: ${after}`);
