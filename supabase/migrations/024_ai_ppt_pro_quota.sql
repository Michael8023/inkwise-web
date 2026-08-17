-- AI PPT is a Pro-only feature: six task starts per calendar month are included,
-- then each additional task costs 20 stored credits.
alter table public.usage_ledger drop constraint if exists usage_ledger_feature_check;
alter table public.usage_ledger add constraint usage_ledger_feature_check
  check (feature in ('summary_short','summary_full','explain','chat','figure_explain','table_extract','ai_ppt'));

create or replace function public.consume_ai_ppt_quota(
  p_user_id uuid,
  p_request_id text,
  p_input_chars integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement public.user_entitlements%rowtype;
  prior public.usage_ledger%rowtype;
  plan_name text;
  used_count integer := 0;
  charge integer := 0;
begin
  select * into prior from public.usage_ledger where request_id = p_request_id limit 1;
  if prior.id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'chargedCredits', prior.credits,
      'creditsRemaining', (select credits_remaining from public.user_entitlements where user_id = p_user_id));
  end if;

  select * into entitlement from public.user_entitlements where user_id = p_user_id for update;
  plan_name := (select name from public.plans where id = entitlement.plan_id);
  if entitlement.user_id is null or plan_name <> 'pro' or entitlement.status <> 'active' or entitlement.period_end <= now() then
    return jsonb_build_object('ok', false, 'error', 'PRO_REQUIRED');
  end if;

  select count(*) into used_count
  from public.usage_ledger
  where user_id = p_user_id
    and feature = 'ai_ppt'
    and status <> 'failed'
    and created_at >= date_trunc('month', now());

  if used_count >= 6 then
    charge := 20;
    if entitlement.credits_remaining < charge then
      return jsonb_build_object('ok', false, 'error', 'PPT_CREDITS_INSUFFICIENT', 'requiredCredits', charge,
        'creditsRemaining', entitlement.credits_remaining);
    end if;
    update public.user_entitlements
    set credits_remaining = credits_remaining - charge, updated_at = now()
    where user_id = p_user_id
    returning * into entitlement;
  end if;

  insert into public.usage_ledger(user_id, feature, model, credits, request_id, input_chars, status)
  values (p_user_id, 'ai_ppt', 'docmee-ppt-generate', charge, p_request_id, greatest(p_input_chars, 0), 'reserved');

  return jsonb_build_object('ok', true, 'duplicate', false, 'freeUsed', used_count + 1,
    'freeRemaining', greatest(6 - used_count - 1, 0), 'chargedCredits', charge,
    'creditsRemaining', entitlement.credits_remaining);
end;
$$;

revoke all on function public.consume_ai_ppt_quota(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.consume_ai_ppt_quota(uuid,text,integer) to service_role;
