create table if not exists public.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  product_code text not null check (product_code in ('points-50','points-250','points-500','pro-month')),
  product_type text not null check (product_type in ('credits','pro_month')),
  credits integer check (credits is null or credits >= 0),
  duration_days integer check (duration_days is null or duration_days between 1 and 366),
  batch_label text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  check ((product_type = 'credits' and credits is not null and duration_days is null) or (product_type = 'pro_month' and credits is null and duration_days is not null))
);

create index if not exists redemption_codes_batch_created_idx on public.redemption_codes(batch_label, created_at desc);
create index if not exists redemption_codes_redeemed_idx on public.redemption_codes(redeemed_at desc nulls first);
alter table public.redemption_codes enable row level security;
revoke all on table public.redemption_codes from anon, authenticated;
grant all on table public.redemption_codes to service_role;

create or replace function public.redeem_redemption_code(p_user_id uuid, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare voucher public.redemption_codes%rowtype; entitlement public.user_entitlements%rowtype; pro_plan uuid;
begin
  select * into voucher from public.redemption_codes where code_hash = p_code_hash for update;
  if voucher.id is null then raise exception 'REDEMPTION_CODE_INVALID'; end if;
  if voucher.redeemed_at is not null then raise exception 'REDEMPTION_CODE_REDEEMED'; end if;
  select * into entitlement from public.user_entitlements where user_id = p_user_id for update;
  if entitlement.user_id is null then raise exception 'ENTITLEMENT_NOT_FOUND'; end if;
  update public.redemption_codes set redeemed_by = p_user_id, redeemed_at = now() where id = voucher.id;
  if voucher.product_type = 'pro_month' then
    select id into pro_plan from public.plans where name = 'pro' limit 1;
    if pro_plan is null then raise exception 'PRO_PLAN_NOT_FOUND'; end if;
    update public.user_entitlements set plan_id = pro_plan, status = 'active', period_start = now(), period_end = greatest(period_end, now()) + make_interval(days => voucher.duration_days), updated_at = now() where user_id = p_user_id returning * into entitlement;
    return jsonb_build_object('ok', true, 'productCode', voucher.product_code, 'productType', voucher.product_type, 'durationDays', voucher.duration_days, 'periodEnd', entitlement.period_end, 'creditsRemaining', entitlement.credits_remaining);
  end if;
  update public.user_entitlements set credits_remaining = credits_remaining + voucher.credits, updated_at = now() where user_id = p_user_id returning * into entitlement;
  return jsonb_build_object('ok', true, 'productCode', voucher.product_code, 'productType', voucher.product_type, 'credits', voucher.credits, 'creditsRemaining', entitlement.credits_remaining);
end; $$;

revoke all on function public.redeem_redemption_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_redemption_code(uuid, text) to service_role;
