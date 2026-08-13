create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id),
  operation text not null check (operation in ('add', 'subtract', 'set')),
  amount bigint not null,
  credits_before bigint not null,
  credits_after bigint not null check (credits_after >= 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists credit_adjustments_user_created_idx
  on public.credit_adjustments(user_id, created_at desc);

alter table public.admin_users enable row level security;
alter table public.credit_adjustments enable row level security;
revoke all on table public.admin_users from public, anon, authenticated;
revoke all on table public.credit_adjustments from public, anon, authenticated;
grant all on table public.admin_users to service_role;
grant all on table public.credit_adjustments to service_role;

create or replace function public.admin_list_users(
  p_search text default '',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  username text,
  display_name text,
  plan_name text,
  plan_id uuid,
  credits_remaining bigint,
  period_end timestamptz,
  status text,
  created_at timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public, auth
as $$
  select
    u.id,
    u.email::text,
    p.username,
    p.display_name,
    pl.name,
    e.plan_id,
    coalesce(e.credits_remaining, 0),
    e.period_end,
    coalesce(e.status, 'inactive'),
    u.created_at,
    count(*) over()
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_entitlements e on e.user_id = u.id
  left join public.plans pl on pl.id = e.plan_id
  where trim(coalesce(p_search, '')) = ''
     or u.email ilike '%' || trim(p_search) || '%'
     or p.username ilike '%' || trim(p_search) || '%'
     or p.display_name ilike '%' || trim(p_search) || '%'
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create or replace function public.admin_adjust_credits(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_operation text,
  p_amount bigint,
  p_plan_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement public.user_entitlements%rowtype;
  before_credits bigint;
  after_credits bigint;
begin
  if not exists (select 1 from public.admin_users where user_id = p_admin_user_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_operation not in ('add', 'subtract', 'set') or p_amount < 0 then
    raise exception 'INVALID_ADJUSTMENT';
  end if;

  select * into entitlement
  from public.user_entitlements
  where user_id = p_user_id
  for update;
  if entitlement.user_id is null then raise exception 'ENTITLEMENT_NOT_FOUND'; end if;
  before_credits := entitlement.credits_remaining;
  after_credits := case p_operation
    when 'add' then before_credits + p_amount
    when 'subtract' then greatest(0, before_credits - p_amount)
    else p_amount
  end;

  if p_plan_id is not null and not exists (
    select 1 from public.plans where id = p_plan_id and is_active = true
  ) then raise exception 'PLAN_NOT_FOUND'; end if;

  update public.user_entitlements
  set credits_remaining = after_credits,
      plan_id = coalesce(p_plan_id, plan_id),
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_adjustments(
    user_id, admin_user_id, operation, amount,
    credits_before, credits_after, note
  ) values (
    p_user_id, p_admin_user_id, p_operation, p_amount,
    before_credits, after_credits, nullif(left(trim(coalesce(p_note, '')), 300), '')
  );

  return jsonb_build_object(
    'ok', true,
    'creditsBefore', before_credits,
    'creditsAfter', after_credits
  );
end;
$$;

revoke all on function public.admin_list_users(text,integer,integer) from public, anon, authenticated;
revoke all on function public.admin_adjust_credits(uuid,uuid,text,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_list_users(text,integer,integer) to service_role;
grant execute on function public.admin_adjust_credits(uuid,uuid,text,bigint,uuid,text) to service_role;

