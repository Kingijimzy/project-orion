-- User-authored trading rules, one row per signed-in user, checked deterministically against journal entries.
create table if not exists public.trading_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);
alter table public.trading_rules enable row level security;
create policy trading_rules_owner_all on public.trading_rules for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select, insert, update, delete on public.trading_rules to authenticated;
