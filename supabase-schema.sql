-- ================================================================
-- Smart Expense Tracker — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query
-- ================================================================

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null,
  payment text not null,
  merchant text,
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

drop policy if exists "Users can view their own expenses" on public.expenses;
drop policy if exists "Users can insert their own expenses" on public.expenses;
drop policy if exists "Users can update their own expenses" on public.expenses;
drop policy if exists "Users can delete their own expenses" on public.expenses;
drop policy if exists "Users can view their own incomes" on public.incomes;
drop policy if exists "Users can insert their own incomes" on public.incomes;
drop policy if exists "Users can update their own incomes" on public.incomes;
drop policy if exists "Users can delete their own incomes" on public.incomes;

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
  category text not null,
  payment text not null,
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

-- Recurring income (salary, allowance, rent, etc.) ---------------------------
create table if not exists public.recurring_incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  source text not null,
  amount numeric(12, 2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly','monthly','yearly')),
  start_date date not null,
  next_due date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists recurring_incomes_user_id_idx on public.recurring_incomes(user_id);
alter table public.recurring_incomes enable row level security;
drop policy if exists "Users can view their own recurring incomes" on public.recurring_incomes;
drop policy if exists "Users can insert their own recurring incomes" on public.recurring_incomes;
drop policy if exists "Users can update their own recurring incomes" on public.recurring_incomes;
drop policy if exists "Users can delete their own recurring incomes" on public.recurring_incomes;
create policy "Users can view their own recurring incomes" on public.recurring_incomes
  for select using (auth.uid() = user_id);
create policy "Users can insert their own recurring incomes" on public.recurring_incomes
  for insert with check (auth.uid() = user_id);
create policy "Users can update their own recurring incomes" on public.recurring_incomes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own recurring incomes" on public.recurring_incomes
  for delete using (auth.uid() = user_id);


-- Budgets (monthly limits per category, plus an overall limit under category 'all') ------
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  category text not null,
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

-- Per-user category and payment labels; transaction keys remain stable on rename.
create table if not exists public.user_categories (
  user_id uuid references auth.users(id) on delete cascade not null,
  category_key text not null,
  label text not null check (char_length(label) between 1 and 32),
  icon text not null default 'fa-tag',
  color text not null default '#6b7280',
  active boolean not null default true,
  is_builtin boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  primary key (user_id, category_key),
  unique (user_id, label)
);
create table if not exists public.user_payment_methods (
  user_id uuid references auth.users(id) on delete cascade not null,
  payment_key text not null,
  label text not null check (char_length(label) between 1 and 32),
  icon text not null default 'fa-wallet',
  color text not null default '#4f46e5',
  active boolean not null default true,
  is_builtin boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  primary key (user_id, payment_key),
  unique (user_id, label)
);
create unique index if not exists user_categories_user_label_lower_idx
  on public.user_categories (user_id, lower(label));
create unique index if not exists user_payment_methods_user_label_lower_idx
  on public.user_payment_methods (user_id, lower(label));
alter table public.user_categories enable row level security;
alter table public.user_payment_methods enable row level security;
drop policy if exists "Users manage their own categories" on public.user_categories;
create policy "Users manage their own categories" on public.user_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage their own payment methods" on public.user_payment_methods;
create policy "Users manage their own payment methods" on public.user_payment_methods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per-user display preferences. Currency remains fixed to MYR throughout the app.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_format text not null default 'dmy_short' check (date_format in ('dmy_short','dmy','ymd')),
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
drop policy if exists "Users manage their own preferences" on public.user_preferences;
create policy "Users manage their own preferences" on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Monthly report email preferences ------------------------------------------
create table if not exists public.monthly_report_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  recipient_email text not null,
  enabled boolean not null default false,
  sent_for_month date,
  updated_at timestamptz not null default now(),
  constraint monthly_report_email_format check (recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);

alter table public.monthly_report_preferences enable row level security;
drop policy if exists "Users can view their own monthly report preference" on public.monthly_report_preferences;
drop policy if exists "Users can insert their own monthly report preference" on public.monthly_report_preferences;
drop policy if exists "Users can update their own monthly report preference" on public.monthly_report_preferences;
create policy "Users can view their own monthly report preference"
  on public.monthly_report_preferences for select using (auth.uid() = user_id);
create policy "Users can insert their own monthly report preference"
  on public.monthly_report_preferences for insert with check (auth.uid() = user_id);
create policy "Users can update their own monthly report preference"
  on public.monthly_report_preferences for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Compatibility upgrades for databases created before all current features.
alter table public.expenses add column if not exists merchant text;
alter table public.expenses add column if not exists note text;
create index if not exists expenses_user_merchant_idx
  on public.expenses (user_id, merchant) where merchant is not null;

-- Remove legacy fixed-category/payment constraints for personal options.
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses drop constraint if exists expenses_payment_check;
alter table public.recurring_expenses drop constraint if exists recurring_expenses_category_check;
alter table public.recurring_expenses drop constraint if exists recurring_expenses_payment_check;
alter table public.budgets drop constraint if exists budgets_category_check;

-- Monthly email scheduling is optional. Configure and deploy the email function,
-- then add project_url, publishable_key, monthly_report_cron_secret to Vault.
-- If not ready, the schema still applies; rerun this file after setup to schedule.
do $setup$
declare
  vault_secret_count integer := 0;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $query$
      select count(*)::integer
      from vault.decrypted_secrets
      where name in ('project_url', 'publishable_key', 'monthly_report_cron_secret')
    $query$ into vault_secret_count;
  end if;

  if vault_secret_count = 3 then
    begin
      execute 'create extension if not exists pg_cron with schema pg_catalog';
      execute 'create extension if not exists pg_net with schema extensions';
      execute $query$
        select cron.unschedule(jobid)
        from cron.job
        where jobname = 'monthly-report-email'
      $query$;
      execute $query$
        select cron.schedule(
          'monthly-report-email',
          '5 * * * *',
          $job$
            select net.http_post(
              url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/monthly-report-email',
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
                'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'monthly_report_cron_secret')
              ),
              body := '{}'::jsonb
            ) as request_id;
          $job$
        )
      $query$;
      raise notice 'Monthly report email scheduler configured.';
    exception when others then
      raise notice 'Schema setup completed, but email scheduling was skipped: %', sqlerrm;
    end;
  else
    raise notice 'Schema setup completed. Email scheduling will be installed after its three Vault secrets are configured and this file is run again.';
  end if;
end
$setup$;
