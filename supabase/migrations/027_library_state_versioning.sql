-- Browser writes are asynchronous and can arrive out of order. Only accept a
-- state snapshot when it is at least as new as the version already stored.
create or replace function public.save_library_paper_state(
  p_paper_id uuid,
  p_reader_state jsonb,
  p_layout_result jsonb,
  p_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.library_papers where id = p_paper_id and user_id = auth.uid()
  ) then
    raise exception 'LIBRARY_PAPER_NOT_FOUND';
  end if;

  insert into public.library_paper_states(paper_id, user_id, reader_state, layout_result, updated_at)
  values (p_paper_id, auth.uid(), p_reader_state, p_layout_result, p_updated_at)
  on conflict (paper_id) do update
    set reader_state = excluded.reader_state,
        layout_result = excluded.layout_result,
        updated_at = excluded.updated_at
    where public.library_paper_states.updated_at <= excluded.updated_at;
  return true;
end;
$$;

revoke all on function public.save_library_paper_state(uuid,jsonb,jsonb,timestamptz) from public, anon;
grant execute on function public.save_library_paper_state(uuid,jsonb,jsonb,timestamptz) to authenticated;
