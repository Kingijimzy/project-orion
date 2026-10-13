create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 60000),
  provider text not null default 'gemini' check (provider in ('gemini', 'openrouter', 'openai-compatible', 'deepseek-compatible')),
  model_id text,
  assistant_mode text not null default 'trading-coach' check (assistant_mode in ('general', 'trading-coach', 'chart-analysis', 'journal-review')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint messages_conversation_owner_fk
    foreign key (conversation_id, user_id)
    references public.conversations(id, user_id) on delete cascade
);

create index if not exists conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index if not exists messages_owner_conversation_created_idx on public.messages(user_id, conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Users can read their conversations"
  on public.conversations for select to authenticated using (auth.uid() = user_id);
create policy "Users can create their conversations"
  on public.conversations for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can rename their conversations"
  on public.conversations for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their conversations"
  on public.conversations for delete to authenticated using (auth.uid() = user_id);

create policy "Users can read their messages"
  on public.messages for select to authenticated using (
    auth.uid() = user_id and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );
create policy "Users can create messages in their conversations"
  on public.messages for insert to authenticated with check (
    auth.uid() = user_id and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- Messages are append-only from the API. No UPDATE or DELETE policies are provided.

grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant usage on schema public to authenticated;
