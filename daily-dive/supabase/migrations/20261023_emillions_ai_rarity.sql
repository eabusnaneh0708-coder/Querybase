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


create or replace function public.get_my_daily_submission(p_guest_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'id', s.id, 'total_score', s.total_score, 'answers', s.answers,
    'results', s.results, 'rank_name', s.rank_name,
    'submitted_at', s.submitted_at, 'nickname', gp.nickname
  ) into result
  from public.submissions s
  join public.guest_players gp on gp.guest_id=s.guest_id
  join public.daily_challenges c on c.id=s.challenge_id
  where s.guest_id=p_guest_id
    and c.challenge_date=(now() at time zone 'America/New_York')::date
    and c.status in ('published','closed')
  limit 1;
  return result;
end;
$$;

create or replace function public.get_daily_leaderboard(p_challenge_date date default null)
returns table(nickname text,total_score int,submitted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select gp.nickname, sum(s.total_score)::int as total_score, max(s.submitted_at) as submitted_at
  from public.submissions s
  join public.guest_players gp on gp.guest_id=s.guest_id
  join public.daily_challenges c on c.id=s.challenge_id
  where c.status in ('published','closed')
    and (p_challenge_date is null or c.challenge_date=p_challenge_date)
  group by gp.guest_id, gp.nickname
  order by sum(s.total_score) desc, max(s.submitted_at) asc
  limit 100;
$$;

revoke all on function public.get_daily_challenge() from public;
grant execute on function public.get_daily_challenge() to anon, authenticated;
revoke all on function public.get_my_daily_submission(uuid) from public;
grant execute on function public.get_my_daily_submission(uuid) to anon, authenticated;
revoke all on function public.get_daily_leaderboard(date) from public;
grant execute on function public.get_daily_leaderboard(date) to anon, authenticated;


-- Atomically increment answer frequency so simultaneous submissions are not lost.
create or replace function public.record_answer_observation(
  p_question_id uuid, p_normalized_answer text, p_answer_display text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.answer_observations(question_id,normalized_answer,answer_display,occurrences,updated_at)
  values (p_question_id, p_normalized_answer, p_answer_display, 1, now())
  on conflict (question_id,normalized_answer) do update
    set occurrences = public.answer_observations.occurrences + 1,
        answer_display = excluded.answer_display,
        updated_at = now();
end;
$$;
revoke all on function public.record_answer_observation(uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_answer_observation(uuid,text,text) to service_role;

-- Force all new submissions through the server-side AI validation/scoring endpoint.
revoke all on function public.submit_daily_dive(uuid,text,jsonb) from public, anon, authenticated;
