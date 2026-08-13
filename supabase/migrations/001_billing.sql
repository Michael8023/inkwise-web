create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(), name text unique not null,
  monthly_credits integer not null check (monthly_credits >= 0),
  max_context_chars integer not null default 120000,
  allowed_models jsonb not null default '[]'::jsonb,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id), credits_remaining bigint not null default 0,
  period_start timestamptz not null default now(), period_end timestamptz not null default (now() + interval '1 month'),
  status text not null default 'active', updated_at timestamptz not null default now()
);
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('summary_short','summary_full','explain','chat')),
  model text not null, credits integer not null, request_id text unique not null,
  input_chars integer not null default 0, output_chars integer not null default 0,
  status text not null default 'reserved', error_code text, created_at timestamptz not null default now()
);
create table if not exists public.model_catalog (
  model_id text primary key, display_name text not null, credit_multiplier numeric not null default 1,
  enabled boolean not null default true, available_features jsonb not null default '["summary","explain","chat"]'::jsonb
);
create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade, feature text not null,
  window_start timestamptz not null, request_count integer not null default 1,
  primary key(user_id,feature,window_start)
);
insert into public.plans(name, monthly_credits, max_context_chars) values ('free',100,120000),('pro',2000,120000) on conflict (name) do nothing;
insert into public.model_catalog(model_id,display_name,credit_multiplier) values ('gemini-2.5-flash-lite','Gemini 2.5 Flash Lite',1) on conflict do nothing;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare free_plan uuid;
begin
  insert into public.profiles(id,username,display_name) values (new.id,new.raw_user_meta_data->>'username',coalesce(new.raw_user_meta_data->>'display_name',new.email)) on conflict (id) do nothing;
  select id into free_plan from public.plans where name='free' limit 1;
  insert into public.user_entitlements(user_id,plan_id,credits_remaining) values (new.id,free_plan,100) on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.consume_credits(p_user_id uuid,p_feature text,p_model text,p_credits integer,p_request_id text,p_input_chars integer default 0) returns jsonb language plpgsql security definer set search_path = public as $$
declare entitlement public.user_entitlements%rowtype; prior public.usage_ledger%rowtype;
begin
  select * into prior from public.usage_ledger where request_id=p_request_id limit 1;
  if prior.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'creditsRemaining',(select credits_remaining from public.user_entitlements where user_id=p_user_id)); end if;
  select * into entitlement from public.user_entitlements where user_id=p_user_id for update;
  if entitlement.period_end <= now() then
    update public.user_entitlements e set credits_remaining=p.monthly_credits,period_start=now(),period_end=now()+interval '1 month',updated_at=now()
      from public.plans p where e.user_id=p_user_id and p.id=e.plan_id returning e.* into entitlement;
  end if;
  if entitlement.user_id is null or entitlement.status <> 'active' or entitlement.credits_remaining < p_credits then return jsonb_build_object('ok',false,'error','QUOTA_EXCEEDED'); end if;
  update public.user_entitlements set credits_remaining=credits_remaining-p_credits,updated_at=now() where user_id=p_user_id;
  insert into public.usage_ledger(user_id,feature,model,credits,request_id,input_chars) values(p_user_id,p_feature,p_model,p_credits,p_request_id,p_input_chars);
  return jsonb_build_object('ok',true,'duplicate',false,'creditsRemaining',entitlement.credits_remaining-p_credits);
end; $$;
create or replace function public.refund_credits(p_request_id text,p_error_code text) returns void language plpgsql security definer set search_path = public as $$
declare row public.usage_ledger%rowtype; begin select * into row from public.usage_ledger where request_id=p_request_id for update; if row.id is not null and row.status='reserved' then update public.user_entitlements set credits_remaining=credits_remaining+row.credits,updated_at=now() where user_id=row.user_id; update public.usage_ledger set status='failed',error_code=p_error_code where id=row.id; end if; end; $$;
create or replace function public.complete_usage(p_request_id text,p_output_chars integer) returns void language sql security definer set search_path = public as $$
  update public.usage_ledger set status='completed',output_chars=greatest(p_output_chars,0) where request_id=p_request_id and status='reserved';
$$;
create or replace function public.check_rate_limit(p_user_id uuid,p_feature text,p_limit integer default 20) returns boolean language plpgsql security definer set search_path = public as $$
declare current_count integer;
begin
  insert into public.api_rate_limits(user_id,feature,window_start,request_count) values(p_user_id,p_feature,date_trunc('minute',now()),1)
  on conflict(user_id,feature,window_start) do update set request_count=api_rate_limits.request_count+1 returning request_count into current_count;
  return current_count <= p_limit;
end; $$;
revoke all on function public.consume_credits(uuid,text,text,integer,text,integer) from public, anon, authenticated;
revoke all on function public.refund_credits(text,text) from public, anon, authenticated;
revoke all on function public.complete_usage(text,integer) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid,text,text,integer,text,integer) to service_role;
grant execute on function public.refund_credits(text,text) to service_role;
grant execute on function public.complete_usage(text,integer) to service_role;
revoke all on function public.check_rate_limit(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(uuid,text,integer) to service_role;

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.model_catalog enable row level security;
alter table public.api_rate_limits enable row level security;
create policy profiles_self on public.profiles for select using (auth.uid()=id);
create policy plans_read on public.plans for select using (is_active=true);
create policy entitlement_self on public.user_entitlements for select using (auth.uid()=user_id);
create policy usage_self on public.usage_ledger for select using (auth.uid()=user_id);
create policy models_read on public.model_catalog for select using (enabled=true);
