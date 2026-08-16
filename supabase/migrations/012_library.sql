-- Private, per-user PDF library. The 50 MB object cap intentionally matches
-- Supabase Free Storage's maximum file-upload size.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library-pdfs', 'library-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update
set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

create table if not exists public.library_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.library_folders(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists library_folders_unique_name_idx
  on public.library_folders(user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists public.library_papers (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.library_folders(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 500),
  original_name text not null,
  source_url text,
  storage_path text not null unique,
  content_hash text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  page_count integer,
  document_text text,
  archived_at timestamptz,
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, content_hash)
);

create index if not exists library_papers_recent_idx on public.library_papers(user_id, last_opened_at desc) where archived_at is null;
create index if not exists library_papers_folder_idx on public.library_papers(user_id, folder_id, updated_at desc);

create table if not exists public.library_paper_states (
  paper_id uuid primary key references public.library_papers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reader_state jsonb not null default '{}'::jsonb,
  layout_result jsonb,
  updated_at timestamptz not null default now()
);

alter table public.library_folders enable row level security;
alter table public.library_papers enable row level security;
alter table public.library_paper_states enable row level security;

create policy library_folders_owner on public.library_folders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy library_papers_owner on public.library_papers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy library_paper_states_owner on public.library_paper_states for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy library_pdf_read on storage.objects for select using (
  bucket_id = 'library-pdfs' and split_part(name, '/', 1) = auth.uid()::text
);
create policy library_pdf_upload on storage.objects for insert with check (
  bucket_id = 'library-pdfs' and split_part(name, '/', 1) = auth.uid()::text
);
create policy library_pdf_update on storage.objects for update using (
  bucket_id = 'library-pdfs' and split_part(name, '/', 1) = auth.uid()::text
) with check (
  bucket_id = 'library-pdfs' and split_part(name, '/', 1) = auth.uid()::text
);
create policy library_pdf_delete on storage.objects for delete using (
  bucket_id = 'library-pdfs' and split_part(name, '/', 1) = auth.uid()::text
);
