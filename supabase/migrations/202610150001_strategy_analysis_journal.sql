create table if not exists public.strategy_profiles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80), version integer not null default 1 check (version > 0),
  settings jsonb not null, is_selected boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id, id)
);
create unique index if not exists one_selected_strategy_per_user on public.strategy_profiles(user_id) where is_selected;
create table if not exists public.smc_analyses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null, market_category text not null check (market_category in ('spot','linear','inverse')),
  timeframe text not null check (timeframe in ('30','60')), analysis_timestamp timestamptz not null,
  last_market_update timestamptz not null, candle_snapshot jsonb not null, data_quality jsonb not null,
  strategy_profile_id uuid references public.strategy_profiles(id) on delete set null, strategy_name text not null,
  strategy_version integer not null, strategy_settings jsonb not null, engine_version text not null,
  findings jsonb not null, created_at timestamptz not null default now(),
  unique(id, user_id)
);
create index if not exists smc_analyses_user_time_idx on public.smc_analyses(user_id, analysis_timestamp desc);
create index if not exists smc_analyses_user_symbol_idx on public.smc_analyses(user_id, symbol, analysis_timestamp desc);
create table if not exists public.smc_analysis_explanations (
  id uuid primary key default gen_random_uuid(), analysis_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, model_id text, content text not null check (char_length(content) between 1 and 60000), created_at timestamptz not null default now(),
  foreign key (analysis_id, user_id) references public.smc_analyses(id, user_id) on delete cascade
);
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid, symbol text not null, direction text not null check (direction in ('long','short')),
  timeframe text not null, entry numeric not null check(entry > 0), stop_loss numeric check(stop_loss > 0), target numeric check(target > 0), exit_price numeric check(exit_price > 0),
  outcome text not null check(outcome in ('open','win','loss','breakeven','unknown')), setup_type text not null default '', reasoning text not null default '',
  screenshot_refs jsonb not null default '[]'::jsonb, setup_quality integer check(setup_quality between 1 and 5), rule_compliance boolean, execution_quality integer check(execution_quality between 1 and 5), confidence integer check(confidence between 1 and 10), hesitation text not null default '', fomo text not null default '', notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (analysis_id, user_id) references public.smc_analyses(id, user_id)
);
create index if not exists journal_user_created_idx on public.journal_entries(user_id, created_at desc);
create table if not exists public.journal_reviews (
  id uuid primary key default gen_random_uuid(), journal_entry_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, model_id text, review text not null, lessons jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(),
  foreign key (journal_entry_id, user_id) references public.journal_entries(id, user_id) on delete cascade
);
alter table public.strategy_profiles enable row level security;
alter table public.smc_analyses enable row level security;
alter table public.smc_analysis_explanations enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_reviews enable row level security;
create policy strategy_owner_all on public.strategy_profiles for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy smc_analysis_owner_read on public.smc_analyses for select to authenticated using(auth.uid()=user_id);
create policy smc_analysis_owner_insert on public.smc_analyses for insert to authenticated with check(auth.uid()=user_id and (strategy_profile_id is null or exists(select 1 from public.strategy_profiles p where p.id=strategy_profile_id and p.user_id=auth.uid())));
create policy smc_explanation_owner_all on public.smc_analysis_explanations for all to authenticated using(auth.uid()=user_id and exists(select 1 from public.smc_analyses a where a.id=analysis_id and a.user_id=auth.uid())) with check(auth.uid()=user_id and exists(select 1 from public.smc_analyses a where a.id=analysis_id and a.user_id=auth.uid()));
create policy journal_owner_read on public.journal_entries for select to authenticated using(auth.uid()=user_id);
create policy journal_owner_insert on public.journal_entries for insert to authenticated with check(auth.uid()=user_id);
create policy journal_review_owner_all on public.journal_reviews for all to authenticated using(auth.uid()=user_id and exists(select 1 from public.journal_entries j where j.id=journal_entry_id and j.user_id=auth.uid())) with check(auth.uid()=user_id and exists(select 1 from public.journal_entries j where j.id=journal_entry_id and j.user_id=auth.uid()));
grant select, insert, update, delete on public.strategy_profiles to authenticated;
grant select, insert on public.journal_entries to authenticated;
grant select, insert on public.smc_analyses to authenticated;
grant select, insert on public.smc_analysis_explanations, public.journal_reviews to authenticated;
