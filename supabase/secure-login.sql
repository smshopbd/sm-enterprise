-- SM Enterprise — login-based database security
-- Run this once in Supabase → SQL Editor on the shop project.
--
-- How it works:
--   * the app derives a key from the signed-in password (never stored in the database)
--   * each account row carries SHA-256(key) in data.cloudHash
--   * every request sends the key as the x-shop-key header; the policy compares its
--     hash with the active account rows
--   * the first setup may insert the owner row while no account is claimed
--   * the public attendance scanner keeps read/write access to its three collections
--
-- Safe to run more than once: functions are replaced and old sm_rows policies are dropped.

create extension if not exists pgcrypto;

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
        digest(coalesce(current_setting('request.headers', true)::json->>'x-shop-key', ''), 'sha256'),
        'hex'
      )
  );
$$;

-- True until the owner sets the first password (or after a legacy migration
-- where no account carries a cloudHash yet).
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

-- Only reveals one bit: whether the shop already has a password.
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

alter table public.sm_rows enable row level security;

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

-- Verify after running:
--   select public.sm_is_claimed();
--   select policyname, cmd from pg_policies where tablename = 'sm_rows' order by policyname;
