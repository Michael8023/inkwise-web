-- Configurable plans and a single plan assigned to newly-created accounts.
alter table public.plans
  add column if not exists is_default boolean not null default false;

insert into public.plans(name, monthly_credits, max_context_chars, is_default)
values
  ('free', 100, 120000, true),
  ('plus', 600, 120000, false),
  ('pro', 2000, 120000, false)
on conflict (name) do nothing;

update public.plans
set is_default = (name = 'free')
where not exists (select 1 from public.plans where is_default);

create unique index if not exists plans_one_default_idx
  on public.plans (is_default)
  where is_default;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_plan public.plans%rowtype;
  requested_username text;
  safe_username text;
  display_name text;
  suffix integer := 0;
begin
  select * into default_plan
  from public.plans
  where is_default = true and is_active = true
  limit 1;
  if default_plan.id is null then
    raise exception 'DEFAULT_PLAN_NOT_CONFIGURED';
  end if;

  requested_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^[:alnum:]_]+', '', 'g'));
  if requested_username = '' then requested_username := 'inkwise'; end if;
  safe_username := left(requested_username, 24);
  while exists (select 1 from public.profiles where username = safe_username and id <> new.id) loop
    suffix := suffix + 1;
    safe_username := left(requested_username, 24 - length(suffix::text) - 1) || '_' || suffix::text;
  end loop;

  display_name := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  insert into public.profiles(id, username, display_name)
  values (new.id, safe_username, coalesce(display_name, new.email, 'Inkwise 用户'))
  on conflict (id) do update set username = excluded.username, display_name = excluded.display_name, updated_at = now();

  insert into public.user_entitlements(user_id, plan_id, credits_remaining)
  values (new.id, default_plan.id, default_plan.monthly_credits)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.admin_save_plan(
  p_admin_user_id uuid,
  p_plan_id uuid,
  p_name text,
  p_monthly_credits integer,
  p_is_default boolean
)
returns public.plans
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_plan public.plans%rowtype;
  normalized_name text := lower(trim(p_name));
begin
  if not exists (select 1 from public.admin_users where user_id = p_admin_user_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if normalized_name !~ '^[a-z][a-z0-9_-]{1,31}$' or p_monthly_credits < 0 or p_monthly_credits > 10000000 then
    raise exception 'INVALID_PLAN';
  end if;

  if p_plan_id is not null and not p_is_default and exists (
    select 1 from public.plans where id = p_plan_id and is_default
  ) then
    raise exception 'DEFAULT_PLAN_REQUIRED';
  end if;

  if p_is_default then update public.plans set is_default = false where is_default; end if;
  if p_plan_id is null then
    insert into public.plans(name, monthly_credits, is_default)
    values (normalized_name, p_monthly_credits, p_is_default)
    returning * into saved_plan;
  else
    update public.plans
    set name = normalized_name, monthly_credits = p_monthly_credits, is_default = p_is_default
    where id = p_plan_id
    returning * into saved_plan;
    if saved_plan.id is null then raise exception 'PLAN_NOT_FOUND'; end if;
  end if;
  return saved_plan;
exception
  when unique_violation then raise exception 'PLAN_NAME_EXISTS';
end;
$$;

revoke all on function public.admin_save_plan(uuid,uuid,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.admin_save_plan(uuid,uuid,text,integer,boolean) to service_role;
