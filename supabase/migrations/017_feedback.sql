create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'suggestion' check (category in ('suggestion','bug','other')),
  content text not null check (char_length(trim(content)) between 5 and 2000),
  status text not null default 'todo' check (status in ('todo','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_feedback_status_created_idx on public.user_feedback(status, created_at desc);
alter table public.user_feedback enable row level security;
create policy user_feedback_insert_self on public.user_feedback for insert to authenticated with check (auth.uid() = user_id);
create policy user_feedback_read_self on public.user_feedback for select to authenticated using (auth.uid() = user_id);
revoke all on table public.user_feedback from anon;
grant select, insert on table public.user_feedback to authenticated;
grant all on table public.user_feedback to service_role;
