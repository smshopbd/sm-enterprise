-- SM Enterprise X1 — Supabase schema
-- Replace the single PLACEHOLDER_HASH with the SHA-256 of a long shop passcode
-- (see lockdown.sql), then run the WHOLE file in the Supabase SQL Editor.
-- This shared passcode is not per-user identity or server-enforced user roles.

begin;

do $migration$
declare
  shop_hash constant text := 'PLACEHOLDER_HASH';
begin
  -- Fail before any schema/data changes, rather than installing a broken gate.
  if shop_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Replace the shop hash placeholder with a lowercase SHA-256 digest before running this script';
  end if;

  if to_regclass('public.sm_rows') is not null then
    lock table public.sm_rows in access exclusive mode;
  end if;
  -- PostgreSQL ORs permissive policies. Unknown policies must be reviewed, not
  -- silently left in place beside the passcode gate (or silently deleted).
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sm_rows'
      and policyname not in ('sm_rows_read', 'sm_rows_write', 'sm_rows_modify', 'sm_rows_remove')
  ) then
    raise exception 'Unexpected policies on public.sm_rows; review and explicitly remove them before rerunning';
  end if;

  create table if not exists public.sm_rows (
    collection   text        not null,
    row_id       text        not null,
    data         jsonb       not null default '{}'::jsonb,
    updated_at   timestamptz not null default now(),
    primary key (collection, row_id)
  );

  create index if not exists sm_rows_collection_idx on public.sm_rows (collection);
  create index if not exists sm_rows_updated_idx on public.sm_rows (updated_at desc);

  -- Keep updated_at honest on every upsert; the app never sends it.
  create or replace function public.sm_touch_updated_at()
  returns trigger
  language plpgsql
  as $body$
  begin
    new.updated_at := now();
    return new;
  end;
  $body$;

  drop trigger if exists sm_rows_touch on public.sm_rows;
  create trigger sm_rows_touch
    before update on public.sm_rows
    for each row execute function public.sm_touch_updated_at();

  alter table public.sm_rows enable row level security;
  create extension if not exists pgcrypto with schema extensions;

  -- Quote the validated hash as a SQL literal; never interpolate a passcode.
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

  -- Live updates between the shop's own devices (pull also merges).
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sm_rows'
  ) then
    alter publication supabase_realtime add table public.sm_rows;
  end if;
end;
$migration$;

commit;

-- Shared document numbers need no extra objects: the app keeps counters inside
-- sm_rows under "__counters" and moves them with an atomic compare-and-set.
