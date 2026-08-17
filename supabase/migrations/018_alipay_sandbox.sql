create table if not exists public.payment_products (
  code text primary key check (code ~ '^[a-z0-9_-]{2,40}$'),
  name text not null,
  credits integer not null check (credits > 0),
  amount_cents integer not null check (amount_cents > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.payment_products(code,name,credits,amount_cents) values
  ('sandbox-mini','沙箱测试 · 100 AI 额度',100,1),
  ('sandbox-plus','沙箱测试 · 1,000 AI 额度',1000,10)
on conflict (code) do nothing;

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  out_trade_no text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.payment_products(code),
  product_name text not null,
  credits integer not null check (credits > 0),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','paid','closed')),
  alipay_trade_no text unique,
  notify_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_orders_user_created_idx on public.payment_orders(user_id, created_at desc);
alter table public.payment_products enable row level security;
alter table public.payment_orders enable row level security;
create policy payment_products_read on public.payment_products for select to authenticated using (active = true);
create policy payment_orders_read_self on public.payment_orders for select to authenticated using (auth.uid() = user_id);
revoke all on table public.payment_products, public.payment_orders from anon;
grant select on public.payment_products, public.payment_orders to authenticated;
grant all on table public.payment_products, public.payment_orders to service_role;

create or replace function public.complete_alipay_order(p_out_trade_no text, p_alipay_trade_no text, p_total_amount numeric, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare purchase public.payment_orders%rowtype; expected_amount numeric;
begin
  select * into purchase from public.payment_orders where out_trade_no=p_out_trade_no for update;
  if purchase.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  expected_amount := purchase.amount_cents::numeric / 100;
  if p_total_amount <> expected_amount then raise exception 'ORDER_AMOUNT_MISMATCH'; end if;
  if purchase.status = 'paid' then return jsonb_build_object('ok',true,'duplicate',true,'userId',purchase.user_id,'credits',purchase.credits); end if;
  if purchase.status <> 'pending' then raise exception 'ORDER_NOT_PAYABLE'; end if;
  update public.payment_orders set status='paid',alipay_trade_no=p_alipay_trade_no,notify_payload=p_payload,paid_at=now(),updated_at=now() where id=purchase.id;
  update public.user_entitlements set credits_remaining=credits_remaining+purchase.credits,updated_at=now() where user_id=purchase.user_id;
  return jsonb_build_object('ok',true,'duplicate',false,'userId',purchase.user_id,'credits',purchase.credits);
end;
$$;
revoke all on function public.complete_alipay_order(text,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.complete_alipay_order(text,text,numeric,jsonb) to service_role;
