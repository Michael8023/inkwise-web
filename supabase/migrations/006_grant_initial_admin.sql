do $$
declare
  target_user_id uuid;
begin
  select id into target_user_id
  from auth.users
  where lower(email) = lower('1114709266@qq.com')
  limit 1;

  if target_user_id is null then
    raise exception 'ADMIN_USER_NOT_FOUND: 1114709266@qq.com';
  end if;

  insert into public.admin_users(user_id)
  values (target_user_id)
  on conflict (user_id) do nothing;
end;
$$;
