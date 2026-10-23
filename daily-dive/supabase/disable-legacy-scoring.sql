-- Run this only AFTER the new Emillions frontend is live and the emillions-api
-- Edge Function is deployed and working. This prevents clients from bypassing AI scoring.
revoke all on function public.submit_daily_dive(uuid,text,jsonb) from public, anon, authenticated;
