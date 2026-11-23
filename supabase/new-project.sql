-- SM Enterprise X1 — fresh Supabase project setup
-- Run this WHOLE file once in Supabase → SQL Editor.
-- Creates sm_rows, the login-based key gate (sm_shop_key_ok), the first-claim
-- window, RLS policies, and the realtime publication entry.
-- Safe to run more than once: objects are created if missing and policies are replaced.
--
-- Do not run schema.sql or lockdown.sql afterwards: those install the older
-- shared-passcode policy and would overwrite the login-based policies below.

begin;

create extension if not exists pgcrypto with schema extensions;

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

-- True when the request header matches an active account's cloudHash.
create or replace function public.sm_shop_key_ok()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.sm_rows u
    where u.collection = 'sm_users_v1'
      and coalesce((u.data->>'active')::boolean, false)
      and u.data->>'cloudHash' = encode(
        digest(
          coalesce(
            (nullif(current_setting('request.headers', true), ''))::jsonb ->> 'x-shop-key',
            ''
          ),
          'sha256'
        ),
        'hex'
      )
  );
$$;

-- True until the owner sets the first password.
create or replace function public.sm_users_unclaimed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.sm_rows u
    where u.collection = 'sm_users_v1'
      and nullif(u.data->>'cloudHash', '') is not null
  );
$$;

-- Reveals one bit only: whether the shop already has a password.
create or replace function public.sm_is_claimed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.sm_users_unclaimed();
$$;

grant execute on function public.sm_shop_key_ok() to anon, authenticated;
grant execute on function public.sm_users_unclaimed() to anon, authenticated;
grant execute on function public.sm_is_claimed() to anon, authenticated;

-- Remove every previous sm_rows policy so an older permissive rule cannot survive.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'sm_rows'
  loop
    execute format('drop policy if exists %I on public.sm_rows', p.policyname);
  end loop;
end $$;

-- Select: the shop key, the public attendance scanner, or the first-claim window.
create policy sm_rows_select on public.sm_rows
for select to anon, authenticated
using (
  public.sm_shop_key_ok()
  or collection in ('sm_attendance_v1', 'sm_hrm_staff_v1', 'sm_attendance_settings_v1')
  or (collection = 'sm_users_v1' and public.sm_users_unclaimed())
);

-- Insert: shop key, public attendance rows, or the very first owner account.
create policy sm_rows_insert on public.sm_rows
for insert to anon, authenticated
with check (
  public.sm_shop_key_ok()
  or collection = 'sm_attendance_v1'
  or (
    collection = 'sm_users_v1'
    and public.sm_users_unclaimed()
    and data->>'role' = 'Admin'
    and coalesce((data->>'active')::boolean, false)
    and nullif(data->>'cloudHash', '') is not null
  )
);

-- Update: shop key or public attendance. The users window covers legacy migration.
create policy sm_rows_update on public.sm_rows
for update to anon, authenticated
using (
  public.sm_shop_key_ok()
  or collection = 'sm_attendance_v1'
  or (collection = 'sm_users_v1' and public.sm_users_unclaimed())
)
with check (
  public.sm_shop_key_ok()
  or collection = 'sm_attendance_v1'
  or (collection = 'sm_users_v1' and public.sm_users_unclaimed())
);

-- Delete: shop key or public attendance.
create policy sm_rows_delete on public.sm_rows
for delete to anon, authenticated
using (
  public.sm_shop_key_ok()
  or collection = 'sm_attendance_v1'
);

-- Fast lookup for the gate check.
create index if not exists sm_rows_cloud_hash_idx
  on public.sm_rows ((data->>'cloudHash'))
  where collection = 'sm_users_v1';

-- Live updates between the shop's own devices.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sm_rows'
    ) then
    execute 'alter publication supabase_realtime add table public.sm_rows';
  end if;
end;
$realtime$;

commit;

-- Verify after running:
--   select public.sm_is_claimed();   -- false before the first admin password
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'sm_rows' order by policyname;  -- 4 rows
