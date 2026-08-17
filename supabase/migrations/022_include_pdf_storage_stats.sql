create or replace function public.admin_database_storage_stats()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()) + coalesce((
      select sum(coalesce((o.metadata ->> 'size')::bigint, 0)) from storage.objects o where o.bucket_id = 'library-pdfs'
    ), 0),
    'publicRelationBytes', coalesce((
      select sum(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'm', 'p')
    ), 0),
    'pdfStorageBytes', coalesce((
      select sum(coalesce((o.metadata ->> 'size')::bigint, 0)) from storage.objects o where o.bucket_id = 'library-pdfs'
    ), 0),
    'pdfObjectCount', (select count(*) from storage.objects where bucket_id = 'library-pdfs'),
    'largestTables', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'bytes', bytes) order by bytes desc)
      from (
        select n.nspname || '.' || c.relname as name, pg_total_relation_size(c.oid) as bytes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'm', 'p')
        order by pg_total_relation_size(c.oid) desc limit 8
      ) largest
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_database_storage_stats() from public, anon, authenticated;
grant execute on function public.admin_database_storage_stats() to service_role;
