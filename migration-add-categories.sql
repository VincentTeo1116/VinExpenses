-- ================================================================
-- Migration: new expense categories + optional note
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- (Only needed if you already ran supabase-schema.sql before.
--  Existing rows are kept.)
-- ================================================================

-- 1. Optional note (used to say what an "Other" expense was)
alter table public.expenses add column if not exists note text;

-- 2. Allow the new categories
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check
  check (category in ('beverages','travel','entertain','work','food','shopping','utilities','car','health','other'));
