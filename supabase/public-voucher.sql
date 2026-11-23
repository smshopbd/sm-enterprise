-- Public voucher page for printed QR codes — run once in Supabase → SQL Editor.
--
-- The QR on a voucher opens /v/<type>/<shareKey> on a phone that has never
-- logged in. That page has no shop key, so RLS refuses to read sm_sales_v1 and
-- the visitor only sees "Voucher not found". This function releases exactly the
-- one voucher whose random shareKey was scanned — never a whole collection — so
-- the link cannot be used to enumerate the shop.
--
-- Safe to run more than once.

begin;

create or replace function public.sm_public_voucher(p_type text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $body$
declare
  v_collection text;
  v_data jsonb;
begin
  -- shareKey is 12 random base-36 characters; anything else is not a voucher link.
  if p_key is null or p_key !~ '^[0-9a-z]{8,32}$' then
    return null;
  end if;

  v_collection := case lower(coalesce(p_type, ''))
    when 'sale' then 'sm_sales_v1'
    when 'purchase' then 'sm_purchases_v1'
    when 'cr' then 'sm_sales_returns_v1'
    when 'dr' then 'sm_supplier_returns_v1'
    else null
  end;
  if v_collection is null then
    return null;
  end if;

  select r.data into v_data
  from public.sm_rows r
  where r.collection = v_collection
    and r.data->>'shareKey' = p_key
  limit 1;

  return v_data;
end;
$body$;

revoke all on function public.sm_public_voucher(text, text) from public;
grant execute on function public.sm_public_voucher(text, text) to anon, authenticated;

-- Fast lookup for scanned QR links.
create index if not exists sm_rows_share_key_idx
  on public.sm_rows ((data->>'shareKey'))
  where collection in ('sm_sales_v1', 'sm_purchases_v1', 'sm_sales_returns_v1', 'sm_supplier_returns_v1');

commit;

-- Verify after running (replace the key with one from a printed voucher):
--   select public.sm_public_voucher('sale', '<shareKey>');
-- A missing or unknown key must return null, never an error.
