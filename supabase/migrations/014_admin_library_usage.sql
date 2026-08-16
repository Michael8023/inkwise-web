-- Expose per-user library usage only through the service-role admin endpoint.
drop function if exists public.admin_list_users(text, integer, integer);

create function public.admin_list_users(
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
  library_paper_count bigint,
  library_storage_bytes bigint,
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
    coalesce(library.paper_count, 0),
    coalesce(library.storage_bytes, 0),
    count(*) over()
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_entitlements e on e.user_id = u.id
  left join public.plans pl on pl.id = e.plan_id
  left join lateral (
    select count(*)::bigint as paper_count, coalesce(sum(file_size), 0)::bigint as storage_bytes
    from public.library_papers
    where user_id = u.id
  ) library on true
  where trim(coalesce(p_search, '')) = ''
     or u.email ilike '%' || trim(p_search) || '%'
     or p.username ilike '%' || trim(p_search) || '%'
     or p.display_name ilike '%' || trim(p_search) || '%'
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.admin_list_users(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, integer, integer) to service_role;
