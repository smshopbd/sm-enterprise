import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localEnvPath = path.join(root, '.env.local');
const envPath = existsSync(localEnvPath)
  ? localEnvPath
  : path.join(root, '.env.example');
const envText = await readFile(envPath, 'utf8');
const values = new Map();

for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const separator = trimmed.indexOf('=');
  if (separator < 1) continue;

  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  values.set(key, value);
}

const get = (key, fallback = '') => values.get(key) ?? fallback;
const supabaseUrl = get('SUPABASE_URL');
const supabaseAnonKey = get('SUPABASE_ANON_KEY');
// This file is shipped publicly. Inspect the key itself, not just its env name,
// and never put credentials or decoder errors into logs.
assertPublicSupabaseKey(supabaseAnonKey);

function assertPublicSupabaseKey(value) {
  const key = value.trim();
  const reject = () => { throw new Error('SUPABASE_ANON_KEY must be a public anon or publishable key; refusing to write public config.'); };
  if (/^sb_secret/i.test(key) || key === 'service_role') reject();
  if (!key.includes('.')) return; // Empty/template values and publishable keys.
  const parts = key.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)) || parts[1].length > 8192) reject();
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    reject();
  }
  // JWT parsing here is classification, not signature verification. Only anon
  // JWTs belong in browser config; service_role and other roles fail closed.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.role !== 'anon') reject();
}

const cloudName = get('CLOUDINARY_CLOUD_NAME');
const uploadPreset = get('CLOUDINARY_UPLOAD_PRESET');
// Stable per backend: every device adopts a newly deployed backend exactly
// once, while redeploying against the same project leaves local edits alone.
const version = createHash('sha256').update(`${supabaseUrl}|${supabaseAnonKey}`).digest('hex').slice(0, 12);
const config = {
  version,
  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    enabled: Boolean(supabaseUrl && supabaseAnonKey)
  },
  cloudinary: {
    cloudName,
    uploadPreset,
    folder: get('CLOUDINARY_FOLDER', 'sm-enterprise'),
    enabled: Boolean(cloudName && uploadPreset)
  }
};

const assetsDir = path.join(root, 'public', 'assets');
await mkdir(assetsDir, { recursive: true });
await writeFile(
  path.join(assetsDir, 'cloud-config.json'),
  `${JSON.stringify(config, null, 2)}\n`,
  'utf8'
);

console.info(
  `Generated public cloud config (Supabase: ${config.supabase.enabled ? 'configured' : 'not configured'}, Cloudinary: ${config.cloudinary.enabled ? 'configured' : 'not configured'}).`
);
