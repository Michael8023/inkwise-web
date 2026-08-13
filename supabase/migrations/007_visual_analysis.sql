alter table public.usage_ledger drop constraint if exists usage_ledger_feature_check;
alter table public.usage_ledger add constraint usage_ledger_feature_check
  check (feature in ('summary_short','summary_full','explain','chat','figure_explain','table_extract'));

update public.model_catalog
set available_features = case
  when available_features ? 'visual' then available_features
  else available_features || '["visual"]'::jsonb
end
where model_id in ('gemini-2.5-flash-lite', 'gpt-4o-mini', 'grok-4.5', 'claude-haiku-4-5-20251001', 'gpt-5.4-nano');

