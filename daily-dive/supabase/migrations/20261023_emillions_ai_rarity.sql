-- Emillions AI rarity and named-player migration.
-- Run this AFTER the existing daily-dive/supabase/schema.sql.

alter table public.questions
  add column if not exists category text not null default 'Technology',
  add column if not exists difficulty text not null default 'medium'
    check (difficulty in ('easy','medium','hard','expert')),
  add column if not exists rarity_model jsonb not null default '{}'::jsonb;

alter table public.submissions
  add column if not exists results jsonb not null default '{}'::jsonb,
  add column if not exists rank_name text not null default 'Daily Diver';

create table if not exists public.answer_observations (
  question_id uuid not null references public.questions(id) on delete cascade,
  normalized_answer text not null,
  answer_display text not null,
  occurrences integer not null default 0 check (occurrences >= 0),
  updated_at timestamptz not null default now(),
  primary key (question_id, normalized_answer)
);

create index if not exists answer_observations_count_idx
  on public.answer_observations(question_id, occurrences desc);

-- Preserve the old scores while making future display names unique, case-insensitively.
with ranked as (
  select guest_id, nickname,
         row_number() over (partition by lower(nickname) order by created_at, guest_id) as rn
  from public.guest_players
)
update public.guest_players gp
set nickname = left(r.nickname, 23) || '-' || upper(substr(replace(gp.guest_id::text,'-',''),1,4))
from ranked r
where r.guest_id = gp.guest_id and r.rn > 1;

create unique index if not exists guest_players_nickname_ci_uidx
  on public.guest_players(lower(nickname));

alter table public.answer_observations enable row level security;
revoke all on public.answer_observations from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Public-safe challenge response includes category/difficulty but never accepted answers or model internals.
create or replace function public.get_daily_challenge()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'id', c.id,
    'challenge_date', c.challenge_date,
    'title', c.title,
    'description', c.description,
    'status', c.status,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'position', q.position, 'prompt', q.prompt,
        'base_points', q.base_points, 'category', q.category, 'difficulty', q.difficulty
      ) order by q.position)
      from public.questions q where q.challenge_id = c.id
    ), '[]'::jsonb)
  ) into result
  from public.daily_challenges c
  where c.challenge_date = (now() at time zone 'America/New_York')::date and c.status = 'published';
  return result;
end;
$$;

-- Do not allow direct clients to write rarity observations.
revoke all on public.answer_observations from public, anon, authenticated;
