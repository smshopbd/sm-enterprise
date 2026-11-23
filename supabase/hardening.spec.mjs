import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Structural regression checks only. These tests do not connect to PostgreSQL
// or deploy SQL; transaction/policy behavior still needs a disposable DB review.
for (const name of ['schema.sql', 'lockdown.sql']) {
  const source = await readFile(new URL(name, import.meta.url), 'utf8');
  const sql = source.replace(/--[^\n]*/g, '').trim();

  test(`${name}: one atomic transaction surrounds the migration`, () => {
    assert.match(sql, /^begin;\s+do \$migration\$/);
    assert.match(sql, /end;\s+\$migration\$;\s+commit;$/);
    assert.equal((sql.match(/\bcommit;/g) ?? []).length, 1);
    assert.doesNotMatch(sql, /exception\s+when/); // No swallowed migration errors.
  });

  test(`${name}: rejects its single hash placeholder before any mutation`, () => {
    assert.equal((sql.match(/'PLACEHOLDER_HASH'/g) ?? []).length, 1);
    assert.match(sql, /shop_hash constant text := 'PLACEHOLDER_HASH'/);
    assert.match(sql, /if shop_hash !~ '\^\[0-9a-f\]\{64\}\$' then\s+raise exception/);
    const guard = sql.indexOf('if shop_hash !~');
    const firstMutation = sql.search(/\b(create|alter|drop|insert|update|delete)\s/);
    assert.ok(guard >= 0 && guard < firstMutation);
    assert.match(sql, /\) = %L\s+\$body\$/);
    assert.match(sql, /\$sql\$, shop_hash\)/);
  });

  test(`${name}: fails on unexpected OR policies before replacing the known set`, () => {
    assert.match(sql, /from pg_policies\s+where schemaname = 'public' and tablename = 'sm_rows'/);
    assert.match(sql, /policyname not in \('sm_rows_read', 'sm_rows_write', 'sm_rows_modify', 'sm_rows_remove'\)\s+\) then\s+raise exception/);
    assert.ok(sql.indexOf('from pg_policies') < sql.search(/\b(create|alter|drop)\s/));
    assert.match(sql, /lock table public\.sm_rows in access exclusive mode/);
    assert.equal((sql.match(/drop policy if exists/g) ?? []).length, 4);
    assert.equal((sql.match(/create policy/g) ?? []).length, 4);
    assert.doesNotMatch(sql, /using\s*\(true\)|with check\s*\(true\)/i);
  });

  test(`${name}: explicitly enables RLS and gates every operation`, () => {
    assert.match(sql, /alter table public\.sm_rows enable row level security/);
    assert.match(sql, /for select to anon, authenticated using \(public\.sm_shop_key_ok\(\)\)/);
    assert.match(sql, /for insert to anon, authenticated with check \(public\.sm_shop_key_ok\(\)\)/);
    assert.match(sql, /for update to anon, authenticated\s+using \(public\.sm_shop_key_ok\(\)\) with check \(public\.sm_shop_key_ok\(\)\)/);
    assert.match(sql, /for delete to anon, authenticated using \(public\.sm_shop_key_ok\(\)\)/);
  });
}
