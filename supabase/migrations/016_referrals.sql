alter table public.profiles add column if not exists invite_code text;
alter table public.profiles add column if not exists invited_by uuid references auth.users(id) on delete set null;
alter table public.profiles alter column invite_code set default ('SD' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
update public.profiles set invite_code = 'SD' || upper(substr(replace(id::text, '-', ''), 1, 8)) where invite_code is null;
alter table public.profiles alter column invite_code set not null;
create unique index if not exists profiles_invite_code_unique on public.profiles (upper(invite_code));

create table if not exists public.referral_settings (
  id boolean primary key default true check (id),
  signup_bonus integer not null default 50 check (signup_bonus >= 0 and signup_bonus <= 10000000),
  updated_at timestamptz not null default now()
);
insert into public.referral_settings(id, signup_bonus) values (true, 50) on conflict (id) do nothing;

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users(id) on delete restrict,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  invite_code text not null,
  credits_awarded integer not null check (credits_awarded >= 0),
  created_at timestamptz not null default now()
);
create index if not exists referral_rewards_inviter_idx on public.referral_rewards(inviter_user_id, created_at desc);
alter table public.referral_settings enable row level security;
alter table public.referral_rewards enable row level security;
revoke all on table public.referral_settings, public.referral_rewards from public, anon, authenticated;
grant all on table public.referral_settings, public.referral_rewards to service_role;

alter table public.signup_verification_codes add column if not exists invite_code text;
drop function if exists public.issue_signup_code(text,text,text,timestamptz);
create function public.issue_signup_code(p_email text, p_username text, p_code_hash text, p_expires_at timestamptz, p_invite_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare existing public.signup_verification_codes%rowtype; next_count integer := 1; next_window timestamptz := now();
begin
  select * into existing from public.signup_verification_codes where email=p_email for update;
  if existing.email is not null then
    if existing.last_sent_at > now() - interval '60 seconds' then return jsonb_build_object('ok',false,'error','CODE_COOLDOWN'); end if;
    if existing.send_window_start > now() - interval '1 hour' then
      if existing.send_count >= 5 then return jsonb_build_object('ok',false,'error','CODE_RATE_LIMITED'); end if;
      next_count := existing.send_count + 1; next_window := existing.send_window_start;
    end if;
  end if;
  insert into public.signup_verification_codes(email,username,code_hash,expires_at,attempts,send_count,send_window_start,last_sent_at,consumed_at,invite_code,updated_at)
  values(p_email,p_username,p_code_hash,p_expires_at,0,next_count,next_window,now(),null,nullif(upper(trim(p_invite_code)),''),now())
  on conflict(email) do update set username=excluded.username, code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, send_count=excluded.send_count, send_window_start=excluded.send_window_start,last_sent_at=now(),consumed_at=null,invite_code=excluded.invite_code,updated_at=now();
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.claim_signup_code(p_email text, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare verification public.signup_verification_codes%rowtype;
begin
  select * into verification from public.signup_verification_codes where email=p_email for update;
  if verification.email is null then return jsonb_build_object('ok',false,'error','CODE_INVALID'); end if;
  if verification.consumed_at is not null then return jsonb_build_object('ok',false,'error','CODE_USED'); end if;
  if verification.expires_at <= now() then return jsonb_build_object('ok',false,'error','CODE_EXPIRED'); end if;
  if verification.attempts >= 5 then return jsonb_build_object('ok',false,'error','CODE_ATTEMPTS_EXCEEDED'); end if;
  if verification.code_hash <> p_code_hash then
    update public.signup_verification_codes set attempts=attempts+1,updated_at=now() where email=p_email;
    return jsonb_build_object('ok',false,'error','CODE_INVALID');
  end if;
  update public.signup_verification_codes set consumed_at=now(),updated_at=now() where email=p_email;
  return jsonb_build_object('ok',true,'username',verification.username,'invite_code',verification.invite_code);
end;
$$;

create or replace function public.find_inviter_by_code(p_invite_code text)
returns uuid language sql security definer set search_path = public as $$
  select id from public.profiles where upper(invite_code) = upper(trim(p_invite_code)) limit 1;
$$;

create or replace function public.apply_signup_referral(p_referred_user_id uuid, p_invite_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inviter_id uuid; bonus integer;
begin
  if p_invite_code is null or trim(p_invite_code) = '' then return jsonb_build_object('ok',true,'awarded',0); end if;
  select id into inviter_id from public.profiles where upper(invite_code)=upper(trim(p_invite_code)) limit 1;
  if inviter_id is null then raise exception 'INVITE_CODE_INVALID'; end if;
  if inviter_id = p_referred_user_id then raise exception 'INVITE_CODE_INVALID'; end if;
  if exists(select 1 from public.referral_rewards where referred_user_id=p_referred_user_id) then return jsonb_build_object('ok',true,'awarded',0); end if;
  select signup_bonus into bonus from public.referral_settings where id=true;
  bonus := coalesce(bonus, 50);
  insert into public.referral_rewards(inviter_user_id,referred_user_id,invite_code,credits_awarded) values(inviter_id,p_referred_user_id,upper(trim(p_invite_code)),bonus);
  update public.profiles set invited_by=inviter_id, updated_at=now() where id=p_referred_user_id;
  update public.user_entitlements set credits_remaining=credits_remaining+bonus, updated_at=now() where user_id=p_referred_user_id;
  return jsonb_build_object('ok',true,'awarded',bonus);
end;
$$;

drop function if exists public.admin_list_users(text, integer, integer);
create function public.admin_list_users(p_search text default '', p_limit integer default 30, p_offset integer default 0)
returns table (user_id uuid,email text,username text,display_name text,plan_name text,plan_id uuid,credits_remaining bigint,period_end timestamptz,status text,created_at timestamptz,library_paper_count bigint,library_storage_bytes bigint,invite_code text,invited_by_email text,successful_referral_count bigint,referral_bonus_credits bigint,total_count bigint)
language sql security definer set search_path = public, auth as $$
  select u.id,u.email::text,p.username,p.display_name,pl.name,e.plan_id,coalesce(e.credits_remaining,0),e.period_end,coalesce(e.status,'inactive'),u.created_at,
    coalesce(library.paper_count,0),coalesce(library.storage_bytes,0),p.invite_code,inviter.email::text,
    coalesce(sent.referral_count,0),coalesce(received.bonus_credits,0),count(*) over()
  from auth.users u left join public.profiles p on p.id=u.id left join public.profiles inviter_profile on inviter_profile.id=p.invited_by left join auth.users inviter on inviter.id=inviter_profile.id
  left join public.user_entitlements e on e.user_id=u.id left join public.plans pl on pl.id=e.plan_id
  left join lateral (select count(*)::bigint paper_count,coalesce(sum(file_size),0)::bigint storage_bytes from public.library_papers where user_id=u.id) library on true
  left join lateral (select count(*)::bigint referral_count from public.referral_rewards where inviter_user_id=u.id) sent on true
  left join lateral (select coalesce(sum(credits_awarded),0)::bigint bonus_credits from public.referral_rewards where referred_user_id=u.id) received on true
  where trim(coalesce(p_search,''))='' or u.email ilike '%'||trim(p_search)||'%' or p.username ilike '%'||trim(p_search)||'%' or p.display_name ilike '%'||trim(p_search)||'%' or p.invite_code ilike '%'||trim(p_search)||'%'
  order by u.created_at desc limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
$$;

revoke all on function public.issue_signup_code(text,text,text,timestamptz,text), public.find_inviter_by_code(text), public.apply_signup_referral(uuid,text), public.admin_list_users(text,integer,integer) from public, anon, authenticated;
grant execute on function public.issue_signup_code(text,text,text,timestamptz,text), public.find_inviter_by_code(text), public.apply_signup_referral(uuid,text), public.admin_list_users(text,integer,integer) to service_role;
