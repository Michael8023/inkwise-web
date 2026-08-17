-- Password-reset codes are deliberately separate from signup codes: a code
-- issued for one purpose can never be used for the other.
create table if not exists public.password_reset_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  send_count integer not null default 1,
  send_window_start timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.password_reset_codes enable row level security;
revoke all on table public.password_reset_codes from public, anon, authenticated;
grant all on table public.password_reset_codes to service_role;

create or replace function public.find_password_reset_user(p_email text)
returns uuid language sql security definer set search_path = auth, public as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

create or replace function public.issue_password_reset_code(p_email text, p_code_hash text, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare existing public.password_reset_codes%rowtype; next_count integer := 1; next_window timestamptz := now();
begin
  select * into existing from public.password_reset_codes where email = p_email for update;
  if existing.email is not null then
    if existing.last_sent_at > now() - interval '60 seconds' then return jsonb_build_object('ok', false, 'error', 'CODE_COOLDOWN'); end if;
    if existing.send_window_start > now() - interval '1 hour' then
      if existing.send_count >= 5 then return jsonb_build_object('ok', false, 'error', 'CODE_RATE_LIMITED'); end if;
      next_count := existing.send_count + 1; next_window := existing.send_window_start;
    end if;
  end if;
  insert into public.password_reset_codes (email, code_hash, expires_at, attempts, send_count, send_window_start, last_sent_at, consumed_at, updated_at)
  values (p_email, p_code_hash, p_expires_at, 0, next_count, next_window, now(), null, now())
  on conflict (email) do update set code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, send_count=excluded.send_count, send_window_start=excluded.send_window_start, last_sent_at=now(), consumed_at=null, updated_at=now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.claim_password_reset_code(p_email text, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare verification public.password_reset_codes%rowtype;
begin
  select * into verification from public.password_reset_codes where email = p_email for update;
  if verification.email is null then return jsonb_build_object('ok', false, 'error', 'CODE_INVALID'); end if;
  if verification.consumed_at is not null then return jsonb_build_object('ok', false, 'error', 'CODE_USED'); end if;
  if verification.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'CODE_EXPIRED'); end if;
  if verification.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'CODE_ATTEMPTS_EXCEEDED'); end if;
  if verification.code_hash <> p_code_hash then
    update public.password_reset_codes set attempts=attempts+1, updated_at=now() where email=p_email;
    return jsonb_build_object('ok', false, 'error', 'CODE_INVALID');
  end if;
  update public.password_reset_codes set consumed_at=now(), updated_at=now() where email=p_email;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.find_password_reset_user(text), public.issue_password_reset_code(text,text,timestamptz), public.claim_password_reset_code(text,text) from public, anon, authenticated;
grant execute on function public.find_password_reset_user(text), public.issue_password_reset_code(text,text,timestamptz), public.claim_password_reset_code(text,text) to service_role;
