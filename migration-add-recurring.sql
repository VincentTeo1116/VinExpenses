-- ================================================================
-- Migration: recurring expenses (bills & subscriptions)
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- ALSO make sure migration-add-categories.sql has been run (it adds the
-- expenses.note column that recurring expenses use). Safe to re-run.
-- ================================================================

-- Recurring expenses (bills / subscriptions that post themselves) ----------
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  name text not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null check (category in ('beverages','travel','entertain','work','food','shopping','utilities','car','health','other')),
  payment text not null check (payment in ('bank','card','ewallet')),
  frequency text not null check (frequency in ('weekly','monthly','yearly')),
  start_date date not null,
  next_due date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists recurring_expenses_user_id_idx on public.recurring_expenses (user_id);

alter table public.recurring_expenses enable row level security;

drop policy if exists "Users can view their own recurring" on public.recurring_expenses;
drop policy if exists "Users can insert their own recurring" on public.recurring_expenses;
drop policy if exists "Users can update their own recurring" on public.recurring_expenses;
drop policy if exists "Users can delete their own recurring" on public.recurring_expenses;

create policy "Users can view their own recurring"
  on public.recurring_expenses for select
  using (auth.uid() = user_id);

create policy "Users can insert their own recurring"
  on public.recurring_expenses for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own recurring"
  on public.recurring_expenses for update
  using (auth.uid() = user_id);

create policy "Users can delete their own recurring"
  on public.recurring_expenses for delete
  using (auth.uid() = user_id);
