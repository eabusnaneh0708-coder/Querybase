-- Run after enabling pg_cron, pg_net, and Vault in the Supabase dashboard.
-- Add two secrets in Vault first:
--   emillions_function_url = https://<project-ref>.supabase.co/functions/v1/emillions-api
--   emillions_cron_secret = the same random secret configured as Edge Function CRON_SECRET
-- The function computes the challenge date in America/New_York. 09:05 UTC is safely
-- in the early morning Eastern time in both standard and daylight time.

select cron.unschedule(jobid)
from cron.job
where jobname = 'emillions-generate-daily';

select cron.schedule(
  'emillions-generate-daily',
  '5 9 * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'emillions_function_url'
      limit 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'emillions_cron_secret'
        limit 1
      )
    ),
    body := '{"action":"generate"}'::jsonb
  );
  $job$
);
