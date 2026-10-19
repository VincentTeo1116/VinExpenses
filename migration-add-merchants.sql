-- Merchant names for scanned and manually entered expenses.
-- Run once in Supabase SQL Editor. Safe to re-run.
alter table public.expenses add column if not exists merchant text;

create index if not exists expenses_user_merchant_idx
  on public.expenses (user_id, merchant)
  where merchant is not null;
