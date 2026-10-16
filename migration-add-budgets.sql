-- ================================================================
-- Migration: monthly budgets (per category + overall)
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- Safe to re-run.
-- ================================================================

-- Budgets (monthly limits per category, plus an overall limit under category 'all') ------
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  category text not null check (category in ('all','beverages','travel','entertain','work','food','shopping','utilities','car','health','other')),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (user_id, category)
);

create index if not exists budgets_user_id_idx on public.budgets (user_id);

alter table public.budgets enable row level security;

drop policy if exists "Users can view their own budgets" on public.budgets;
drop policy if exists "Users can insert their own budgets" on public.budgets;
drop policy if exists "Users can update their own budgets" on public.budgets;
drop policy if exists "Users can delete their own budgets" on public.budgets;

create policy "Users can view their own budgets"
  on public.budgets for select
  using (auth.uid() = user_id);

create policy "Users can insert their own budgets"
  on public.budgets for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own budgets"
  on public.budgets for update
  using (auth.uid() = user_id);

create policy "Users can delete their own budgets"
  on public.budgets for delete
  using (auth.uid() = user_id);
