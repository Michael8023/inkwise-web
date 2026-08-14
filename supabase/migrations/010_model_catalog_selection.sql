-- Provider metadata and the administrator-managed allow-list for frontend models.
alter table public.model_catalog
  add column if not exists provider text not null default '其他';

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
begin
  if not exists (select 1 from public.admin_users where user_id = p_admin_user_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if jsonb_typeof(p_models) <> 'array' or jsonb_array_length(p_models) = 0 or jsonb_array_length(p_models) > 500 then
    raise exception 'INVALID_MODELS';
  end if;

  update public.model_catalog set enabled = false;
  for item in select value from jsonb_array_elements(p_models) loop
    model_id_value := trim(item->>'id');
    display_name_value := trim(coalesce(item->>'name', model_id_value));
    provider_value := left(trim(coalesce(item->>'provider', '其他')), 48);
    if model_id_value !~ '^[a-zA-Z0-9._:/-]{1,180}$' or display_name_value = '' then
      raise exception 'INVALID_MODELS';
    end if;
    insert into public.model_catalog(model_id, display_name, provider, enabled, available_features)
    values (model_id_value, left(display_name_value, 180), provider_value, true, '["summary","explain","chat","visual"]'::jsonb)
    on conflict (model_id) do update set
      display_name = excluded.display_name,
      provider = excluded.provider,
      enabled = true;
  end loop;
end;
$$;

revoke all on function public.admin_sync_model_catalog(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.admin_sync_model_catalog(uuid,jsonb) to service_role;
