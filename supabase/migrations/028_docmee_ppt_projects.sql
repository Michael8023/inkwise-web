-- Docmee-backed PPT projects. The upstream Docmee id is intentionally scoped
-- to our authenticated user; it is never accepted from the browser as an
-- authorization identity.
create table if not exists public.ppt_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references public.library_papers(id) on delete cascade,
  docmee_uid text not null,
  docmee_ppt_id text,
  title text not null default '未命名 PPT',
  prompt text not null default '',
  status text not null default 'created' check (status in ('created','editing','generating','completed','failed')),
  last_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ppt_projects_user_recent_idx on public.ppt_projects(user_id, updated_at desc);
create unique index if not exists ppt_projects_docmee_ppt_idx on public.ppt_projects(docmee_ppt_id) where docmee_ppt_id is not null;

alter table public.ppt_projects enable row level security;
drop policy if exists ppt_projects_owner on public.ppt_projects;
-- The browser can read only its task list. Inserts and updates go exclusively
-- through the service-role Edge Function, which derives both user_id and the
-- stable Docmee uid from the authenticated JWT.
create policy ppt_projects_owner_read on public.ppt_projects for select using (auth.uid() = user_id);

create or replace function public.touch_ppt_projects_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists ppt_projects_updated_at on public.ppt_projects;
create trigger ppt_projects_updated_at before update on public.ppt_projects
for each row execute function public.touch_ppt_projects_updated_at();
