-- Monthly report email preferences. Run once in the Supabase SQL Editor.
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
