-- Make Auth user provisioning resilient to duplicate usernames and partial setup.
insert into public.plans(name, monthly_credits, max_context_chars)
values ('free', 100, 120000)
on conflict (name) do update set monthly_credits = excluded.monthly_credits;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan uuid;
  requested_username text;
  safe_username text;
  display_name text;
  suffix integer := 0;
begin
  select id into free_plan from public.plans where name = 'free' and is_active = true limit 1;
  if free_plan is null then
    raise exception 'FREE_PLAN_NOT_CONFIGURED';
  end if;

  requested_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^[:alnum:]_]+', '', 'g'));
  if requested_username = '' then
    requested_username := 'inkwise';
  end if;
  safe_username := left(requested_username, 24);
  while exists (select 1 from public.profiles where username = safe_username and id <> new.id) loop
    suffix := suffix + 1;
    safe_username := left(requested_username, 24 - length(suffix::text) - 1) || '_' || suffix::text;
  end loop;

  display_name := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  insert into public.profiles(id, username, display_name)
  values (new.id, safe_username, coalesce(display_name, new.email, 'Inkwise 用户'))
  on conflict (id) do update set
    username = excluded.username,
    display_name = excluded.display_name,
    updated_at = now();

  insert into public.user_entitlements(user_id, plan_id, credits_remaining)
  values (new.id, free_plan, 100)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
