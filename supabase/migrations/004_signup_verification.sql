create table if not exists public.signup_verification_codes (
  email text primary key,
  username text not null,
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

alter table public.signup_verification_codes enable row level security;

-- No client policies are intentional. Only Edge Functions using service_role
-- can inspect or mutate registration verification state.
revoke all on table public.signup_verification_codes from public, anon, authenticated;
grant all on table public.signup_verification_codes to service_role;

create or replace function public.issue_signup_code(
  p_email text,
  p_username text,
  p_code_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.signup_verification_codes%rowtype;
  next_count integer := 1;
  next_window timestamptz := now();
begin
  select * into existing
  from public.signup_verification_codes
  where email = p_email
  for update;

  if existing.email is not null then
    if existing.last_sent_at > now() - interval '60 seconds' then
      return jsonb_build_object('ok', false, 'error', 'CODE_COOLDOWN');
    end if;

    if existing.send_window_start > now() - interval '1 hour' then
      if existing.send_count >= 5 then
        return jsonb_build_object('ok', false, 'error', 'CODE_RATE_LIMITED');
      end if;
      next_count := existing.send_count + 1;
      next_window := existing.send_window_start;
    end if;
  end if;

  insert into public.signup_verification_codes (
    email, username, code_hash, expires_at, attempts, send_count,
    send_window_start, last_sent_at, consumed_at, updated_at
  ) values (
    p_email, p_username, p_code_hash, p_expires_at, 0, next_count,
    next_window, now(), null, now()
  )
  on conflict (email) do update set
    username = excluded.username,
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0,
    send_count = excluded.send_count,
    send_window_start = excluded.send_window_start,
    last_sent_at = now(),
    consumed_at = null,
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.claim_signup_code(
  p_email text,
  p_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  verification public.signup_verification_codes%rowtype;
begin
  select * into verification
  from public.signup_verification_codes
  where email = p_email
  for update;

  if verification.email is null then
    return jsonb_build_object('ok', false, 'error', 'CODE_INVALID');
  end if;
  if verification.consumed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'CODE_USED');
  end if;
  if verification.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'CODE_EXPIRED');
  end if;
  if verification.attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'CODE_ATTEMPTS_EXCEEDED');
  end if;
  if verification.code_hash <> p_code_hash then
    update public.signup_verification_codes
    set attempts = attempts + 1, updated_at = now()
    where email = p_email;
    return jsonb_build_object('ok', false, 'error', 'CODE_INVALID');
  end if;

  update public.signup_verification_codes
  set consumed_at = now(), updated_at = now()
  where email = p_email;
  return jsonb_build_object('ok', true, 'username', verification.username);
end;
$$;

create or replace function public.release_signup_code(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.signup_verification_codes
  set consumed_at = null, updated_at = now()
  where email = p_email
    and consumed_at > now() - interval '2 minutes';
$$;

revoke all on function public.issue_signup_code(text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.claim_signup_code(text,text) from public, anon, authenticated;
revoke all on function public.release_signup_code(text) from public, anon, authenticated;
grant execute on function public.issue_signup_code(text,text,text,timestamptz) to service_role;
grant execute on function public.claim_signup_code(text,text) to service_role;
grant execute on function public.release_signup_code(text) to service_role;
