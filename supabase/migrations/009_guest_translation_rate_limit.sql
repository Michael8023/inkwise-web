-- Translation is available before sign-in, so anonymous callers need a
-- separate rate-limit key rather than a user UUID.
create table if not exists public.anonymous_rate_limits (
  rate_key text not null,
  feature text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  primary key (rate_key, feature, window_start)
);

alter table public.anonymous_rate_limits enable row level security;
revoke all on table public.anonymous_rate_limits from public, anon, authenticated;
grant all on table public.anonymous_rate_limits to service_role;

create or replace function public.check_anonymous_rate_limit(
  p_rate_key text,
  p_feature text,
  p_limit integer default 10
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare current_count integer;
begin
  insert into public.anonymous_rate_limits(rate_key, feature, window_start, request_count)
  values (p_rate_key, p_feature, date_trunc('minute', now()), 1)
  on conflict(rate_key, feature, window_start) do update
    set request_count = anonymous_rate_limits.request_count + 1
  returning request_count into current_count;
  return current_count <= p_limit;
end;
$$;

revoke all on function public.check_anonymous_rate_limit(text,text,integer) from public, anon, authenticated;
grant execute on function public.check_anonymous_rate_limit(text,text,integer) to service_role;
