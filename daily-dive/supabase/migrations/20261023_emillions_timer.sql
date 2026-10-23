-- Emillions three-minute daily challenge timer.
-- Run this once in Supabase SQL Editor before deploying the updated Edge Function.

create table if not exists public.challenge_attempts (
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  guest_id uuid not null references public.guest_players(guest_id) on delete cascade,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  primary key (challenge_id, guest_id)
);

alter table public.challenge_attempts enable row level security;
revoke all on public.challenge_attempts from public, anon, authenticated;
grant all on public.challenge_attempts to service_role;
