-- SM Enterprise X1 — lock the shop behind a passcode
-- Run the WHOLE file in Supabase SQL Editor only after configuring each device.
-- This shared passcode is not per-user identity or server-enforced user roles.
-- Every holder still has access to all rows allowed by these policies.
--
-- 1. Choose a long passcode (16+ random characters) and enter it on every device.
-- 2. With pgcrypto enabled, calculate its hash in the SQL Editor:
--      select encode(extensions.digest('PASTE-THE-SAME-PASSCODE-HERE', 'sha256'), 'hex');
-- 3. Replace the single PLACEHOLDER_HASH below with the 64-character result.
-- 4. Run the whole file. Any failure rolls back the entire policy change.

begin;

do $migration$
declare
  shop_hash constant text := 'PLACEHOLDER_HASH';
begin
  if shop_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Replace the shop hash placeholder with a lowercase SHA-256 digest before running this script';
  end if;
  if to_regclass('public.sm_rows') is null then
    raise exception 'public.sm_rows is missing; run the reviewed schema script first';
  end if;

  lock table public.sm_rows in access exclusive mode;
  -- Extra permissive policies are ORed together and could bypass our gate.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sm_rows'
      and policyname not in ('sm_rows_read', 'sm_rows_write', 'sm_rows_modify', 'sm_rows_remove')
  ) then
    raise exception 'Unexpected policies on public.sm_rows; review and explicitly remove them before rerunning';
  end if;

  create extension if not exists pgcrypto with schema extensions;
  alter table public.sm_rows enable row level security;

  execute format($sql$
    create or replace function public.sm_shop_key_ok()
    returns boolean
    language sql
    stable
    as $body$
      select encode(
        extensions.digest(
          coalesce(
            (nullif(current_setting('request.headers', true), ''))::jsonb ->> 'x-shop-key',
            ''
          ),
          'sha256'
        ),
        'hex'
      ) = %L
    $body$
  $sql$, shop_hash);

  drop policy if exists "sm_rows_read" on public.sm_rows;
  drop policy if exists "sm_rows_write" on public.sm_rows;
  drop policy if exists "sm_rows_modify" on public.sm_rows;
  drop policy if exists "sm_rows_remove" on public.sm_rows;

  create policy "sm_rows_read" on public.sm_rows
    for select to anon, authenticated using (public.sm_shop_key_ok());

  create policy "sm_rows_write" on public.sm_rows
    for insert to anon, authenticated with check (public.sm_shop_key_ok());

  create policy "sm_rows_modify" on public.sm_rows
    for update to anon, authenticated
    using (public.sm_shop_key_ok()) with check (public.sm_shop_key_ok());

  create policy "sm_rows_remove" on public.sm_rows
    for delete to anon, authenticated using (public.sm_shop_key_ok());
end;
$migration$;

commit;
