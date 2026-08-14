-- Administrator-managed upstream pricing and immutable per-request cost records.
alter table public.model_catalog
  add column if not exists input_price_per_million numeric not null default 0 check (input_price_per_million >= 0),
  add column if not exists output_price_per_million numeric not null default 0 check (output_price_per_million >= 0);

alter table public.usage_ledger
  add column if not exists input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column if not exists output_tokens bigint not null default 0 check (output_tokens >= 0),
  add column if not exists provider_cost numeric not null default 0 check (provider_cost >= 0);

create or replace function public.record_usage_metrics(
  p_request_id text,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ledger_row public.usage_ledger%rowtype;
  input_price numeric := 0;
  output_price numeric := 0;
begin
  select * into ledger_row from public.usage_ledger where request_id = p_request_id for update;
  if ledger_row.id is null or ledger_row.status <> 'completed' then return; end if;

  select input_price_per_million, output_price_per_million into input_price, output_price
  from public.model_catalog where model_id = ledger_row.model;

  update public.usage_ledger
  set input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
      provider_cost = round(
        greatest(coalesce(p_input_tokens, 0), 0)::numeric / 1000000 * coalesce(input_price, 0) +
        greatest(coalesce(p_output_tokens, 0), 0)::numeric / 1000000 * coalesce(output_price, 0),
        8
      )
  where id = ledger_row.id;
end;
$$;

create or replace function public.admin_model_usage_summary(p_admin_user_id uuid)
returns table (
  model_id text,
  request_count bigint,
  input_tokens bigint,
  output_tokens bigint,
  provider_cost numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admin_users where user_id = p_admin_user_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  return query
    select l.model, count(*)::bigint, coalesce(sum(l.input_tokens), 0)::bigint,
      coalesce(sum(l.output_tokens), 0)::bigint, coalesce(sum(l.provider_cost), 0)
    from public.usage_ledger l
    where l.status = 'completed'
    group by l.model;
end;
$$;

create or replace function public.admin_sync_model_catalog(
  p_admin_user_id uuid,
  p_models jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  model_id_value text;
  display_name_value text;
  provider_value text;
  input_price_value numeric;
  output_price_value numeric;
begin
  if not exists (select 1 from public.admin_users where user_id = p_admin_user_id) then raise exception 'ADMIN_REQUIRED'; end if;
  if jsonb_typeof(p_models) <> 'array' or jsonb_array_length(p_models) = 0 or jsonb_array_length(p_models) > 500 then raise exception 'INVALID_MODELS'; end if;

  update public.model_catalog set enabled = false;
  for item in select value from jsonb_array_elements(p_models) loop
    model_id_value := trim(item->>'id');
    display_name_value := trim(coalesce(item->>'name', model_id_value));
    provider_value := left(trim(coalesce(item->>'provider', '其他')), 48);
    input_price_value := coalesce(nullif(item->>'inputPricePerMillion', '')::numeric, 0);
    output_price_value := coalesce(nullif(item->>'outputPricePerMillion', '')::numeric, 0);
    if model_id_value !~ '^[a-zA-Z0-9._:/-]{1,180}$' or display_name_value = ''
       or input_price_value < 0 or output_price_value < 0
       or input_price_value > 1000000 or output_price_value > 1000000 then raise exception 'INVALID_MODELS'; end if;
    insert into public.model_catalog(model_id, display_name, provider, enabled, available_features, input_price_per_million, output_price_per_million)
    values (model_id_value, left(display_name_value, 180), provider_value, true, '["summary","explain","chat","visual"]'::jsonb, input_price_value, output_price_value)
    on conflict (model_id) do update set display_name = excluded.display_name, provider = excluded.provider,
      enabled = true, input_price_per_million = excluded.input_price_per_million, output_price_per_million = excluded.output_price_per_million;
  end loop;
end;
$$;

revoke all on function public.record_usage_metrics(text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.record_usage_metrics(text,bigint,bigint) to service_role;
revoke all on function public.admin_model_usage_summary(uuid) from public, anon, authenticated;
grant execute on function public.admin_model_usage_summary(uuid) to service_role;
