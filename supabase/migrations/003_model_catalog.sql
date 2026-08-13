insert into public.model_catalog(model_id, display_name, credit_multiplier, enabled, available_features)
values
  ('gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite', 1, true, '["summary","explain","chat"]'::jsonb),
  ('gpt-4o-mini', 'GPT-4o mini', 1.2, true, '["summary","explain","chat"]'::jsonb),
  ('grok-4.5', 'Grok 4.5', 1.5, true, '["summary","explain","chat"]'::jsonb),
  ('claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 1.2, true, '["summary","explain","chat"]'::jsonb),
  ('gpt-5.4-nano', 'GPT-5.4 nano', 1.8, true, '["summary","explain","chat"]'::jsonb)
on conflict (model_id) do update set
  display_name = excluded.display_name,
  enabled = true,
  available_features = excluded.available_features;
