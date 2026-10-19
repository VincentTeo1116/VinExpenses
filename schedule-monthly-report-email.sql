-- Run after adding the two Vault secrets and deploying the function.
-- Vault secrets required:
--   project_url   = https://YOUR_PROJECT_REF.supabase.co
--   monthly_report_cron_secret = the same secret as the Edge Function setting
--   publishable_key = your Supabase anon/publishable key
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'monthly-report-email';

select cron.schedule(
  'monthly-report-email',
  '5 * * * *', -- hourly; function sends only on the local month's first day and retries failures during that day
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/monthly-report-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'monthly_report_cron_secret')
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
