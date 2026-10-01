-- ================================================================
-- Smart Expense Tracker — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query
-- ================================================================

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null check (category in ('beverages','travel','entertain','work','food','shopping','utilities','car','health','other')),
  payment text not null check (payment in ('bank','card','ewallet')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  amount numeric(12, 2) not null check (amount > 0),
  source text not null default 'Salary',
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_id_idx on public.expenses (user_id);
create index if not exists incomes_user_id_idx on public.incomes (user_id);

-- ---------- Row Level Security ----------
-- Without these policies, anyone with the anon key could read or
-- write every user's rows. These policies restrict each user to
-- their own data.

alter table public.expenses enable row level security;
alter table public.incomes enable row level security;

create policy "Users can view their own expenses"
  on public.expenses for select
  using (auth.uid() = user_id);

create policy "Users can insert their own expenses"
  on public.expenses for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own expenses"
  on public.expenses for update
  using (auth.uid() = user_id);

create policy "Users can delete their own expenses"
  on public.expenses for delete
  using (auth.uid() = user_id);

create policy "Users can view their own incomes"
  on public.incomes for select
  using (auth.uid() = user_id);

create policy "Users can insert their own incomes"
  on public.incomes for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own incomes"
  on public.incomes for update
  using (auth.uid() = user_id);

create policy "Users can delete their own incomes"
  on public.incomes for delete
  using (auth.uid() = user_id);


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
