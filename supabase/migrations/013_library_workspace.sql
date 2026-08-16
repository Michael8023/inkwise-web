-- Product workspace metadata for the personal literature library.
alter table public.library_papers
  add column if not exists is_favorite boolean not null default false;

create index if not exists library_papers_favorite_idx
  on public.library_papers(user_id, last_opened_at desc)
  where is_favorite and archived_at is null;

create table if not exists public.library_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 48),
  color text not null default '#0e9f9a' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists library_tags_unique_name_idx
  on public.library_tags(user_id, lower(name));

create table if not exists public.library_paper_tags (
  paper_id uuid not null references public.library_papers(id) on delete cascade,
  tag_id uuid not null references public.library_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (paper_id, tag_id)
);

create index if not exists library_paper_tags_tag_idx on public.library_paper_tags(tag_id, paper_id);

alter table public.library_tags enable row level security;
alter table public.library_paper_tags enable row level security;

create policy library_tags_owner on public.library_tags for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy library_paper_tags_owner on public.library_paper_tags for all
  using (exists (select 1 from public.library_papers p where p.id = paper_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.library_papers p where p.id = paper_id and p.user_id = auth.uid()));
