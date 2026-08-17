-- Fixed point pricing: Free users spend 2 points per AI request; Pro is unlimited.
alter table public.model_catalog add column if not exists free_enabled boolean not null default true;
alter table public.model_catalog add column if not exists pro_enabled boolean not null default true;
update public.model_catalog set free_enabled = enabled, pro_enabled = enabled;

alter table public.payment_products drop constraint if exists payment_products_credits_check;
alter table public.payment_products add column if not exists product_type text not null default 'credits' check (product_type in ('credits','pro_month'));
alter table public.payment_products add column if not exists duration_days integer check (duration_days is null or duration_days between 1 and 366);
alter table public.payment_products alter column credits drop not null;
alter table public.payment_products add constraint payment_products_credits_nonnegative check (credits is null or credits >= 0);
alter table public.payment_orders drop constraint if exists payment_orders_credits_check;
alter table public.payment_orders add column if not exists product_type text not null default 'credits' check (product_type in ('credits','pro_month'));
alter table public.payment_orders add column if not exists duration_days integer;
alter table public.payment_orders alter column credits drop not null;
alter table public.payment_orders add constraint payment_orders_credits_nonnegative check (credits is null or credits >= 0);

update public.payment_products set active = false;
insert into public.payment_products(code,name,credits,amount_cents,product_type,duration_days,active) values
  ('points-50','50 AI 积分',50,100,'credits',null,true),
  ('points-250','250 AI 积分',250,500,'credits',null,true),
  ('points-500','500 AI 积分',500,1000,'credits',null,true),
  ('pro-month','Pro 会员 · 30 天',0,3000,'pro_month',30,true)
on conflict (code) do update set name=excluded.name,credits=excluded.credits,amount_cents=excluded.amount_cents,product_type=excluded.product_type,duration_days=excluded.duration_days,active=true;

update public.plans set monthly_credits = 0 where name = 'free';

create or replace function public.consume_credits(p_user_id uuid,p_feature text,p_model text,p_credits integer,p_request_id text,p_input_chars integer default 0) returns jsonb language plpgsql security definer set search_path = public as $$
declare entitlement public.user_entitlements%rowtype; prior public.usage_ledger%rowtype; current_plan text; free_plan uuid;
begin
  select * into prior from public.usage_ledger where request_id=p_request_id limit 1;
  if prior.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'creditsRemaining',(select credits_remaining from public.user_entitlements where user_id=p_user_id)); end if;
  select e.* into entitlement from public.user_entitlements e where e.user_id=p_user_id for update;
  current_plan := (select p.name from public.plans p where p.id=entitlement.plan_id);
  if current_plan = 'pro' and entitlement.status = 'active' and entitlement.period_end > now() then
    insert into public.usage_ledger(user_id,feature,model,credits,request_id,input_chars,status) values(p_user_id,p_feature,p_model,0,p_request_id,p_input_chars,'reserved');
    return jsonb_build_object('ok',true,'pro',true,'creditsRemaining',entitlement.credits_remaining);
  end if;
  if current_plan = 'pro' and entitlement.period_end <= now() then
    select id into free_plan from public.plans where name='free' limit 1;
    update public.user_entitlements set plan_id=free_plan,status='active',updated_at=now() where user_id=p_user_id returning * into entitlement;
  end if;
  if entitlement.user_id is null or entitlement.status <> 'active' or entitlement.credits_remaining < 2 then return jsonb_build_object('ok',false,'error','QUOTA_EXCEEDED'); end if;
  update public.user_entitlements set credits_remaining=credits_remaining-2,updated_at=now() where user_id=p_user_id;
  insert into public.usage_ledger(user_id,feature,model,credits,request_id,input_chars) values(p_user_id,p_feature,p_model,2,p_request_id,p_input_chars);
  return jsonb_build_object('ok',true,'pro',false,'creditsRemaining',entitlement.credits_remaining-2);
end; $$;

create or replace function public.complete_alipay_order(p_out_trade_no text, p_alipay_trade_no text, p_total_amount numeric, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare purchase public.payment_orders%rowtype; expected_amount numeric; pro_plan uuid;
begin
  select * into purchase from public.payment_orders where out_trade_no=p_out_trade_no for update;
  if purchase.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  expected_amount := purchase.amount_cents::numeric / 100;
  if p_total_amount <> expected_amount then raise exception 'ORDER_AMOUNT_MISMATCH'; end if;
  if purchase.status = 'paid' then return jsonb_build_object('ok',true,'duplicate',true,'userId',purchase.user_id); end if;
  if purchase.status <> 'pending' then raise exception 'ORDER_NOT_PAYABLE'; end if;
  update public.payment_orders set status='paid',alipay_trade_no=p_alipay_trade_no,notify_payload=p_payload,paid_at=now(),updated_at=now() where id=purchase.id;
  if purchase.product_type = 'pro_month' then
    select id into pro_plan from public.plans where name='pro' limit 1;
    update public.user_entitlements set plan_id=pro_plan,status='active',period_start=now(),period_end=greatest(period_end,now()) + make_interval(days=>coalesce(purchase.duration_days,30)),updated_at=now() where user_id=purchase.user_id;
  else
    update public.user_entitlements set credits_remaining=credits_remaining+coalesce(purchase.credits,0),updated_at=now() where user_id=purchase.user_id;
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'userId',purchase.user_id,'credits',coalesce(purchase.credits,0),'productType',purchase.product_type);
end; $$;
