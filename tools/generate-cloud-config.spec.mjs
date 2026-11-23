import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Execute only a copied generator against synthetic credentials in a temp root.
const generator = new URL('./generate-cloud-config.mjs', import.meta.url);
const jwt = payload => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'),
  'synthetic-signature'
].join('.');

async function runGenerator(t, key, { existing = false, example = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sm-public-config-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tools'));
  await copyFile(generator, path.join(root, 'tools', 'generate-cloud-config.mjs'));
  await writeFile(path.join(root, example ? '.env.example' : '.env.local'), [
    'SUPABASE_URL=https://synthetic.supabase.co',
    `SUPABASE_ANON_KEY="${key}"`,
    'CLOUDINARY_CLOUD_NAME=synthetic',
    'CLOUDINARY_UPLOAD_PRESET=synthetic-preset'
  ].join('\n'));
  const output = path.join(root, 'public', 'assets', 'cloud-config.json');
  if (existing) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, 'existing-public-config');
  }
  const process = spawnSync(globalThis.process.execPath, [path.join(root, 'tools', 'generate-cloud-config.mjs')], { encoding: 'utf8' });
  return { process, output };
}

for (const [label, key] of [
  ['secret prefix', 'sb_secret_synthetic-never-publish'],
  ['trimmed secret prefix', '  sb_secret_synthetic-never-publish  '],
  ['service role JWT', jwt({ role: 'service_role', marker: 'synthetic-private' })],
  ['unknown JWT role', jwt({ role: 'authenticated' })],
  ['missing JWT role', jwt({ sub: 'synthetic' })],
  ['malformed JWT', 'synthetic.not-json.signature'],
  ['malformed JWT parts', 'a.b.c.d']
]) {
  for (const existing of [false, true]) {
    test(`rejects ${label} before ${existing ? 'overwriting' : 'creating'} public config`, async t => {
      const { process, output } = await runGenerator(t, key, { existing });
      assert.notEqual(process.status, 0);
      const log = process.stdout + process.stderr;
      assert.match(log, /refusing to write public config/);
      assert.equal(log.includes(key.trim()), false, 'must not log key material');
      if (existing) assert.equal(await readFile(output, 'utf8'), 'existing-public-config');
      else await assert.rejects(readFile(output), { code: 'ENOENT' });
    });
  }
}

for (const [label, key] of [
  ['anon JWT', jwt({ role: 'anon' })],
  ['publishable key', 'sb_publishable_synthetic-public-key'],
  ['unconfigured key', '']
]) {
  test(`generates config for ${label}`, async t => {
    const { process, output } = await runGenerator(t, key);
    assert.equal(process.status, 0, process.stderr);
    const config = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(config.supabase.anonKey, key);
    assert.equal(config.supabase.enabled, Boolean(key));
    assert.equal(config.cloudinary.enabled, true);
    if (key) assert.equal((process.stdout + process.stderr).includes(key), false);
  });
}

test('also rejects a secret in the fallback example file', async t => {
  const { process, output } = await runGenerator(t, 'sb_secret_synthetic-example', { example: true });
  assert.notEqual(process.status, 0);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});
