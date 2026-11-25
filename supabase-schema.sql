-- VinExpenses database schema. Run it in the Supabase SQL Editor; it is safe to run again.

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

-- Row Level Security: each user can only read and write their own rows.

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


-- Recurring expenses Section: bills / subscriptions that post themselves
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

-- Recurring income Section: salary, allowance, rent, etc.
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


-- Budgets Section: monthly limits per category, plus an overall limit under category 'all'
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

-- Monthly report email preferences Section
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

-- Confirmed recipients: a report only goes to an address the user confirmed, and only the server can mark it so.
alter table public.monthly_report_preferences add column if not exists verified_email text;
alter table public.monthly_report_preferences add column if not exists verified_at timestamptz;
alter table public.monthly_report_preferences add column if not exists failed_for_month date;
alter table public.monthly_report_preferences drop constraint if exists monthly_report_email_length;
alter table public.monthly_report_preferences
  add constraint monthly_report_email_length check (char_length(recipient_email) between 6 and 254) not valid;
alter table public.monthly_report_preferences drop constraint if exists monthly_report_email_chars;
alter table public.monthly_report_preferences
  add constraint monthly_report_email_chars check (recipient_email ~ '^[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$') not valid;

revoke all on public.monthly_report_preferences from anon, authenticated;
grant select on public.monthly_report_preferences to authenticated;
grant insert (user_id, recipient_email, enabled) on public.monthly_report_preferences to authenticated;
grant update (user_id, recipient_email, enabled, updated_at) on public.monthly_report_preferences to authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists monthly_report_touch on public.monthly_report_preferences;
create trigger monthly_report_touch before update on public.monthly_report_preferences
  for each row execute function public.touch_updated_at();

-- Administrators: server-only table. The first one is registered by the admin-email-test function.
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

-- Registers the first administrator, only if none exists and the account is confirmed.
create or replace function public.claim_first_admin(p_user uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  added boolean;
begin
  perform pg_advisory_xact_lock(7001);
  if exists (select 1 from public.app_admins) then
    return false;
  end if;
  insert into public.app_admins (user_id)
  select u.id from auth.users u
  where u.id = p_user and lower(u.email) = lower(p_email) and u.email_confirmed_at is not null
  returning true into added;
  return coalesce(added, false);
end;
$$;
revoke all on function public.claim_first_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_first_admin(uuid, text) to service_role;

-- Daily counters for email and lookup limits, counted in one statement so two requests can't both pass.
create table if not exists public.usage_counters (
  scope text not null check (char_length(scope) between 1 and 200),
  day date not null,
  used integer not null default 0,
  primary key (scope, day)
);
alter table public.usage_counters enable row level security;
revoke all on public.usage_counters from anon, authenticated;

create or replace function public.consume_quota(p_scope text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  allowed boolean;
begin
  if p_scope is null or p_limit is null or p_limit < 1 then
    return false;
  end if;
  insert into public.usage_counters as c (scope, day, used)
  values (p_scope, today, 1)
  on conflict (scope, day) do update set used = c.used + 1
    where c.used < p_limit
  returning true into allowed;
  -- Old counters are no use after a few days; tidy a few at a time so the table stays small.
  delete from public.usage_counters where ctid in (select ctid from public.usage_counters where day < today - 3 limit 20);
  return coalesce(allowed, false);
end;
$$;
revoke all on function public.consume_quota(text, integer) from public, anon, authenticated;
grant execute on function public.consume_quota(text, integer) to service_role;

-- Stricter values for icons and colours, because they end up in the page.
alter table public.user_categories drop constraint if exists user_categories_icon_format;
alter table public.user_categories add constraint user_categories_icon_format check (icon ~ '^fa-[a-z0-9-]{1,40}$') not valid;
alter table public.user_categories drop constraint if exists user_categories_color_format;
alter table public.user_categories add constraint user_categories_color_format check (color ~ '^#[0-9a-fA-F]{3,8}$') not valid;
alter table public.user_payment_methods drop constraint if exists user_payment_methods_icon_format;
alter table public.user_payment_methods add constraint user_payment_methods_icon_format check (icon ~ '^fa-[a-z0-9-]{1,40}$') not valid;
alter table public.user_payment_methods drop constraint if exists user_payment_methods_color_format;
alter table public.user_payment_methods add constraint user_payment_methods_color_format check (color ~ '^#[0-9a-fA-F]{3,8}$') not valid;

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

-- Schedules the monthly email once the three Vault secrets exist; run this file again after adding them.
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


-- Receipt scanning limits: how many scans each user used today. Server only.
create table if not exists public.receipt_scan_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  ocr_scans integer not null default 0,
  ai_calls integer not null default 0,
  primary key (user_id, day)
);

alter table public.receipt_scan_usage enable row level security;
revoke all on public.receipt_scan_usage from anon, authenticated;

-- Counts one use and says if it was allowed, safely even for two scans at the same moment.
create or replace function public.consume_receipt_quota(p_user uuid, p_kind text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  allowed boolean;
begin
  if p_kind = 'ocr' then
    insert into public.receipt_scan_usage as u (user_id, day, ocr_scans)
    values (p_user, today, 1)
    on conflict (user_id, day) do update set ocr_scans = u.ocr_scans + 1
      where u.ocr_scans < p_limit
    returning true into allowed;
  elsif p_kind = 'ai' then
    insert into public.receipt_scan_usage as u (user_id, day, ai_calls)
    values (p_user, today, 1)
    on conflict (user_id, day) do update set ai_calls = u.ai_calls + 1
      where u.ai_calls < p_limit
    returning true into allowed;
  else
    raise exception 'unknown quota kind %', p_kind;
  end if;
  return coalesce(allowed, false);
end;
$$;

revoke all on function public.consume_receipt_quota(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_receipt_quota(uuid, text, integer) to service_role;


-- Telegram bot tables. Server only: the website and other users can't read or change them.
create table if not exists public.telegram_links (
  chat_id bigint primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  last_expense_id uuid,
  linked_at timestamptz not null default now()
);
alter table public.telegram_links enable row level security;
revoke all on public.telegram_links from anon, authenticated;

-- One-time link codes, stored as a hash (never the code itself). Deleted when used or expired.
create table if not exists public.telegram_link_codes (
  code_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists telegram_link_codes_user_idx on public.telegram_link_codes (user_id);
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;

-- Telegram re-sends a message if it thinks we missed it; remembering update ids stops an expense being added twice.
create table if not exists public.telegram_seen (
  update_id bigint primary key,
  seen_at timestamptz not null default now()
);
alter table public.telegram_seen enable row level security;
revoke all on public.telegram_seen from anon, authenticated;


-- Telegram bot, part 2: language, weekly summary and receipts waiting for confirmation.
alter table public.telegram_links add column if not exists lang text not null default 'en';
alter table public.telegram_links drop constraint if exists telegram_links_lang_check;
alter table public.telegram_links add constraint telegram_links_lang_check check (lang in ('en', 'ms', 'zh'));
alter table public.telegram_links add column if not exists digest_on boolean not null default false;
alter table public.telegram_links add column if not exists last_digest_week date;

-- A receipt waiting for Save, or an amount about to be typed. One per chat, and it expires.
create table if not exists public.telegram_pending (
  chat_id bigint primary key,
  kind text not null check (kind in ('receipt', 'receipt_amount', 'edit_amount')),
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null
);
alter table public.telegram_pending enable row level security;
revoke all on public.telegram_pending from anon, authenticated;

-- Schedules the weekly Telegram summary (hourly check; it only sends on Monday morning).
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
        where jobname = 'telegram-weekly-digest'
      $query$;
      execute $query$
        select cron.schedule(
          'telegram-weekly-digest',
          '10 * * * *',
          $job$
            select net.http_post(
              url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/telegram-digest',
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
      raise notice 'Telegram weekly summary scheduler configured.';
    exception when others then
      raise notice 'Schema setup completed, but the Telegram weekly summary was not scheduled: %', sqlerrm;
    end;
  else
    raise notice 'Telegram weekly summary will be scheduled after the three Vault secrets exist and this file is run again.';
  end if;
end
$setup$;


-- Plan: fixed deposits, loans and their reminders. Each person only sees their own rows.
create table if not exists public.fixed_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  bank text check (bank is null or char_length(bank) <= 60),
  principal numeric(14, 2) not null check (principal >= 1 and principal <= 100000000),
  rate numeric(6, 3) not null check (rate > 0 and rate <= 30),
  start_date date not null,
  tenure_value integer not null check (tenure_value between 1 and 3650),
  tenure_unit text not null check (tenure_unit in ('days', 'months', 'years')),
  maturity_date date not null,
  payout text not null default 'maturity' check (payout in ('maturity', 'monthly', 'quarterly', 'yearly')),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  day_basis smallint not null default 365 check (day_basis in (360, 365)),
  reminders_on boolean not null default true,
  reminder_days smallint[] not null default '{7,1,0}',
  status text not null default 'open' check (status in ('open', 'closed')),
  interest_recorded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_deposits_dates check (maturity_date > start_date and maturity_date <= start_date + 3660),
  constraint fixed_deposits_reminder_days check (cardinality(reminder_days) <= 5 and 0 <= all (reminder_days) and 60 >= all (reminder_days))
);
create index if not exists fixed_deposits_user_idx on public.fixed_deposits (user_id);
create index if not exists fixed_deposits_maturity_idx on public.fixed_deposits (maturity_date) where status = 'open';
alter table public.fixed_deposits enable row level security;
drop policy if exists "Users manage their own fixed deposits" on public.fixed_deposits;
create policy "Users manage their own fixed deposits" on public.fixed_deposits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  lender text check (lender is null or char_length(lender) <= 60),
  principal numeric(14, 2) not null check (principal >= 1 and principal <= 100000000),
  rate numeric(6, 3) not null check (rate >= 0 and rate <= 40),
  method text not null check (method in ('reducing', 'flat')),
  term_months integer not null check (term_months between 1 and 480),
  first_payment_date date not null,
  fees numeric(14, 2) not null default 0 check (fees >= 0),
  instalment numeric(14, 2) not null check (instalment > 0),
  reminders_on boolean not null default true,
  reminder_days smallint[] not null default '{3,0}',
  status text not null default 'open' check (status in ('open', 'closed')),
  paid_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loans_reminder_days check (cardinality(reminder_days) <= 5 and 0 <= all (reminder_days) and 60 >= all (reminder_days))
);
create index if not exists loans_user_idx on public.loans (user_id);
alter table public.loans enable row level security;
drop policy if exists "Users manage their own loans" on public.loans;
create policy "Users manage their own loans" on public.loans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A loan added to recurring expenses stops by itself after the last instalment.
alter table public.recurring_expenses add column if not exists end_date date;
alter table public.recurring_expenses add column if not exists loan_id uuid references public.loans (id) on delete set null;
create unique index if not exists recurring_expenses_loan_idx on public.recurring_expenses (loan_id) where loan_id is not null;

-- Reminder settings, including the 24-hour snooze, kept with the account for every device.
alter table public.user_preferences add column if not exists reminder_hour smallint not null default 9;
alter table public.user_preferences add column if not exists reminder_hide_amounts boolean not null default false;
alter table public.user_preferences add column if not exists reminder_popup text not null default 'auto';
alter table public.user_preferences add column if not exists reminder_snooze_until timestamptz;
alter table public.user_preferences drop constraint if exists user_preferences_reminder_hour_check;
alter table public.user_preferences add constraint user_preferences_reminder_hour_check check (reminder_hour between 0 and 23);
alter table public.user_preferences drop constraint if exists user_preferences_reminder_popup_check;
alter table public.user_preferences add constraint user_preferences_reminder_popup_check check (reminder_popup in ('auto', 'always', 'never'));

-- Set when Telegram says the person blocked the bot, so reminders stop being retried and the app can say so.
alter table public.telegram_links add column if not exists reminders_blocked_at timestamptz;

-- One row per reminder sent. The unique key stops a reminder going out twice. Server only.
create table if not exists public.reminder_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_kind text not null check (item_kind in ('fd', 'loan')),
  item_id uuid not null,
  due_date date not null,
  lead_days smallint not null,
  attempts smallint not null default 1,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reminder_log_once unique (item_kind, item_id, due_date, lead_days)
);
create index if not exists reminder_log_user_idx on public.reminder_log (user_id);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- Schedules the reminder check every hour; each reminder is sent once.
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
        where jobname = 'plan-reminders'
      $query$;
      execute $query$
        select cron.schedule(
          'plan-reminders',
          '20 * * * *',
          $job$
            select net.http_post(
              url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/plan-reminders',
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
      raise notice 'Plan reminder scheduler configured.';
    exception when others then
      raise notice 'Schema setup completed, but plan reminders were not scheduled: %', sqlerrm;
    end;
  else
    raise notice 'Plan reminders will be scheduled after the three Vault secrets exist and this file is run again.';
  end if;
end
$setup$;


-- At most 200 deposits and 200 loans per account, so one account can't slow reminders for everyone.
create or replace function public.enforce_plan_row_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  already integer;
  existing boolean;
begin
  execute format('select exists (select 1 from public.%I where id = $1)', tg_table_name) into existing using new.id;
  if existing then
    return new; -- an upsert of a row that is already there: not a new row
  end if;
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into already using new.user_id;
  if already >= 200 then
    raise exception 'You can keep at most 200 of these per account. Delete ones you no longer need, then try again.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists fixed_deposits_row_limit on public.fixed_deposits;
create trigger fixed_deposits_row_limit before insert on public.fixed_deposits
  for each row execute function public.enforce_plan_row_limit();
drop trigger if exists loans_row_limit on public.loans;
create trigger loans_row_limit before insert on public.loans
  for each row execute function public.enforce_plan_row_limit();


-- Sign-in Protection Section: codes, lockouts, recovery codes. Server only; the website can't read or change any of it.
-- One row per emailed code (sign-up or password reset), used for the 3-a-day and 10-a-month limits.
create table if not exists public.auth_code_requests (
  id bigint generated always as identity primary key,
  email text not null check (char_length(email) between 3 and 254),
  purpose text not null check (purpose in ('signup', 'recovery')),
  sent_at timestamptz not null default now()
);
create index if not exists auth_code_requests_email_idx on public.auth_code_requests (email, sent_at);
alter table public.auth_code_requests enable row level security;
revoke all on public.auth_code_requests from anon, authenticated;

-- Wrong-password counts per email and device. device_id '*' is the whole email (many devices failing, or an admin block).
create table if not exists public.auth_lockouts (
  email text not null check (char_length(email) between 3 and 254),
  device_id text not null check (char_length(device_id) between 1 and 80),
  fails integer not null default 0,
  last_fail_at timestamptz,
  blocked_at timestamptz,
  manual boolean not null default false,
  primary key (email, device_id)
);
alter table public.auth_lockouts enable row level security;
revoke all on public.auth_lockouts from anon, authenticated;

-- Counts one wrong password and blocks after p_max within p_hours. Returns when the block started, or null.
create or replace function public.record_signin_failure(p_email text, p_device text, p_max integer, p_email_max integer, p_hours integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(hours => p_hours);
  device_fails integer;
  email_fails integer;
  blocked timestamptz;
begin
  if p_email is null or p_device is null or p_device = '*' then
    return null;
  end if;
  insert into public.auth_lockouts as l (email, device_id, fails, last_fail_at)
  values (p_email, p_device, 1, now())
  on conflict (email, device_id) do update
    set fails = case when l.last_fail_at is null or l.last_fail_at < cutoff then 1 else l.fails + 1 end,
        last_fail_at = now()
  returning fails into device_fails;

  if device_fails >= p_max then
    update public.auth_lockouts set blocked_at = now()
    where email = p_email and device_id = p_device and (blocked_at is null or blocked_at < cutoff)
    returning blocked_at into blocked;
  end if;

  -- Many devices failing for one email looks like guessing with a changing device id: block the email itself.
  select coalesce(sum(fails), 0) into email_fails from public.auth_lockouts
  where email = p_email and device_id <> '*' and last_fail_at >= cutoff;
  if email_fails >= p_email_max then
    insert into public.auth_lockouts as l (email, device_id, fails, last_fail_at, blocked_at)
    values (p_email, '*', email_fails, now(), now())
    on conflict (email, device_id) do update
      set fails = excluded.fails, last_fail_at = now(),
          blocked_at = case when l.manual or (l.blocked_at is not null and l.blocked_at >= cutoff) then l.blocked_at else now() end;
    blocked := coalesce(blocked, now());
  end if;

  -- Old rows are no use: tidy a few at a time so the table stays small.
  delete from public.auth_lockouts where ctid in (
    select ctid from public.auth_lockouts where not manual and last_fail_at < now() - interval '7 days' limit 20);
  return blocked;
end;
$$;
revoke all on function public.record_signin_failure(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.record_signin_failure(text, text, integer, integer, integer) to service_role;

-- One-time recovery codes for people who lose their authenticator. Only a hash is stored.
create table if not exists public.mfa_recovery_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id);
alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from anon, authenticated;

-- Admin Section: what administrators did, the feedback inbox, and the numbers the user list needs.
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null check (char_length(action) between 1 and 60),
  target_user uuid,
  detail text check (detail is null or char_length(detail) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_time_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

-- The log can be added to but never changed or deleted, even by the server.
create or replace function public.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'This record can not be changed or deleted.' using errcode = 'insufficient_privilege';
end;
$$;
drop trigger if exists admin_audit_log_locked on public.admin_audit_log;
create trigger admin_audit_log_locked before update or delete on public.admin_audit_log
  for each row execute function public.forbid_change();

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text not null check (char_length(email) between 3 and 254),
  topic text not null check (topic in ('locked_out', 'code_limit', 'report', 'bug', 'other')),
  message text not null check (char_length(message) between 5 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- Per-user facts for the admin list: last expense date and whether Telegram is linked. No amounts, no records.
create or replace function public.admin_user_stats(p_users uuid[])
returns table (user_id uuid, last_expense_at timestamptz, telegram_linked boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id,
         (select max(e.created_at) from public.expenses e where e.user_id = u.id),
         exists (select 1 from public.telegram_links t where t.user_id = u.id)
  from unnest(p_users) as u(id);
$$;
revoke all on function public.admin_user_stats(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_user_stats(uuid[]) to service_role;

-- Monthly Report Delivery Section: Telegram or email, the last result, and how often it was sent again.
alter table public.monthly_report_preferences alter column recipient_email drop not null;
alter table public.monthly_report_preferences add column if not exists channel text not null default 'auto';
alter table public.monthly_report_preferences drop constraint if exists monthly_report_channel_check;
alter table public.monthly_report_preferences add constraint monthly_report_channel_check check (channel in ('auto', 'telegram', 'email'));
alter table public.monthly_report_preferences add column if not exists last_status text;
alter table public.monthly_report_preferences drop constraint if exists monthly_report_status_check;
alter table public.monthly_report_preferences add constraint monthly_report_status_check check (last_status is null or last_status in ('sent', 'failed', 'pending'));
alter table public.monthly_report_preferences add column if not exists last_channel text;
alter table public.monthly_report_preferences add column if not exists last_attempt_at timestamptz;
alter table public.monthly_report_preferences add column if not exists last_month date;
alter table public.monthly_report_preferences add column if not exists resend_count smallint not null default 0;
-- People may choose the channel; only the server writes the result columns.
grant insert (user_id, recipient_email, enabled, channel) on public.monthly_report_preferences to authenticated;
grant update (user_id, recipient_email, enabled, channel, updated_at) on public.monthly_report_preferences to authenticated;

-- Authenticator Section: when someone has turned on an authenticator, their data needs a fully signed-in session.
-- If this check itself ever fails it lets the request through, so a mistake here can never lock everyone out.
create or replace function public.mfa_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'aal', '') = 'aal2' then
    return true;
  end if;
  return not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified');
exception when others then
  return true;
end;
$$;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

do $mfa$
declare
  t text;
begin
  foreach t in array array['expenses', 'incomes', 'recurring_expenses', 'recurring_incomes', 'budgets', 'user_categories',
                           'user_payment_methods', 'user_preferences', 'monthly_report_preferences', 'fixed_deposits', 'loans']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "Authenticator required when enabled" on public.%I', t);
      execute format('create policy "Authenticator required when enabled" on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t);
    end if;
  end loop;
end
$mfa$;

-- Scan statistics for the administrator (MON-01). Only the engine, whether it worked, the kind of failure and the time it took:
-- never a receipt image, its text, an amount or who scanned it. No policies on purpose: only the server (service key) can read or write it.
create table if not exists public.scan_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  engine text not null,
  ok boolean not null,
  reason text,
  ms integer
);
create index if not exists scan_events_at_idx on public.scan_events (at desc);
alter table public.scan_events enable row level security;
