-- Keep the upstream task identifier server-side and bind it to the user who
-- started the job. This prevents the shared provider credential from becoming
-- an authorization boundary for status and download requests.
create table if not exists public.ppt_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_request_id text unique,
  upstream_ppt_id text not null unique,
  status text not null default 'generating' check (status in ('generating', 'completed', 'failed')),
  file_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ppt_jobs_user_recent_idx
  on public.ppt_jobs(user_id, created_at desc);

alter table public.ppt_jobs enable row level security;
create policy ppt_jobs_owner on public.ppt_jobs for select using (auth.uid() = user_id);
