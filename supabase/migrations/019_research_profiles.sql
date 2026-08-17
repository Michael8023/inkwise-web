-- A concise, user-owned research thread used to personalize Brainstorm.
create table if not exists public.research_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  overview text not null default '' check (char_length(overview) <= 6000),
  updated_at timestamptz not null default now()
);

alter table public.research_profiles enable row level security;

create policy research_profiles_owner on public.research_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

