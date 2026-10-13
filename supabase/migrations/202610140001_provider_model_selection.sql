alter table public.conversations
  add column if not exists provider text not null default 'gemini'
    check (provider in ('gemini', 'openrouter', 'openai-compatible', 'deepseek-compatible')),
  add column if not exists model_id text;

create index if not exists conversations_provider_model_idx
  on public.conversations(user_id, provider, model_id);

update public.messages
set model_id = nullif(model_id, '')
where model_id = '';
