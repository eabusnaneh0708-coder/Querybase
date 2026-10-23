-- Daily Dive guest-player schema for Supabase.
-- Run this in a NEW/EMPTY Supabase project before publishing the game.
-- Players do not create accounts. A random browser guest ID is used for each day.
-- Only trusted hosts use Supabase Auth to manage questions.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  role text not null default 'player' check (role in ('player','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge_date date not null unique,
  title text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  position int not null check (position > 0),
  prompt text not null,
  accepted_answers text[] not null default '{}',
  base_points int not null default 100 check (base_points between 1 and 1000),
  unique(challenge_id, position)
);

create table if not exists public.guest_players (
  guest_id uuid primary key,
  nickname text not null check (char_length(nickname) between 1 and 32),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  guest_id uuid not null references public.guest_players(guest_id),
  answers jsonb not null default '{}'::jsonb,
  total_score int not null default 0,
  submitted_at timestamptz not null default now(),
  unique(challenge_id, guest_id)
);

create index if not exists submissions_challenge_score_idx on public.submissions(challenge_id,total_score desc,submitted_at);
create index if not exists challenges_date_status_idx on public.daily_challenges(challenge_date,status);

create or replace function public.handle_new_host()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id,nickname,role)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nickname',''), split_part(coalesce(new.email,'host'),'@',1)), 'player')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_host();

-- Public-safe challenge function: never returns accepted answers.
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
        'id', q.id, 'position', q.position, 'prompt', q.prompt, 'base_points', q.base_points
      ) order by q.position)
      from public.questions q where q.challenge_id = c.id
    ), '[]'::jsonb)
  ) into result
  from public.daily_challenges c
  where c.challenge_date = current_date and c.status = 'published';
  return result;
end;
$$;

-- Submit once per daily challenge. Scoring and answer validation happen in the database.
create or replace function public.submit_daily_dive(p_guest_id uuid, p_nickname text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  challenge_row public.daily_challenges%rowtype;
  q record;
  given text;
  valid_count int;
  match_count int;
  total int := 0;
  safe_nickname text;
  inserted public.submissions%rowtype;
begin
  if p_guest_id is null then raise exception 'Missing guest ID. Refresh the page and try again.'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then raise exception 'Answers must be an object.'; end if;
  safe_nickname := left(regexp_replace(coalesce(trim(p_nickname), ''), '[^a-zA-Z0-9 _-]', '', 'g'), 32);
  if safe_nickname = '' then safe_nickname := 'Diver-' || upper(substr(replace(p_guest_id::text,'-',''),1,4)); end if;

  select * into challenge_row from public.daily_challenges
    where challenge_date = current_date and status = 'published' for share;
  if not found then raise exception 'There is no published challenge today.'; end if;

  insert into public.guest_players(guest_id,nickname,last_seen_at)
  values (p_guest_id,safe_nickname,now())
  on conflict (guest_id) do update set nickname = excluded.nickname, last_seen_at = now();

  if exists(select 1 from public.submissions s where s.challenge_id=challenge_row.id and s.guest_id=p_guest_id) then
    raise exception 'A submission has already been recorded for this device today.';
  end if;

  for q in select id, accepted_answers, base_points from public.questions
    where challenge_id=challenge_row.id order by position
  loop
    given := lower(trim(coalesce(p_answers->>q.id::text,'')));
    if given = '' then continue; end if;
    select count(*) into match_count from unnest(q.accepted_answers) a where lower(trim(a))=given;
    if match_count > 0 then
      select count(*) into valid_count from public.submissions s
      cross join lateral jsonb_each_text(s.answers) a(key,value)
      where s.challenge_id=challenge_row.id and a.key=q.id::text and lower(trim(a.value))=given;
      total := total + greatest(1, floor(q.base_points::numeric / greatest(1, coalesce(valid_count,0)+1))::int);
    end if;
  end loop;

  insert into public.submissions(challenge_id,guest_id,answers,total_score)
  values (challenge_row.id,p_guest_id,p_answers,total)
  returning * into inserted;

  return jsonb_build_object(
    'id', inserted.id,
    'total_score', inserted.total_score,
    'answers', inserted.answers,
    'submitted_at', inserted.submitted_at,
    'nickname', safe_nickname
  );
end;
$$;

create or replace function public.get_daily_leaderboard(p_challenge_date date default current_date)
returns table(nickname text,total_score int,submitted_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select gp.nickname, s.total_score, s.submitted_at
  from public.submissions s
  join public.guest_players gp on gp.guest_id=s.guest_id
  join public.daily_challenges c on c.id=s.challenge_id
  where c.challenge_date=p_challenge_date and c.status in ('published','closed')
  order by s.total_score desc, s.submitted_at asc
  limit 100;
$$;

-- Keep the underlying tables private to browser clients. Access is through the RPC functions above.
alter table public.profiles enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.questions enable row level security;
alter table public.guest_players enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "Host profile can read own row" on public.profiles;
create policy "Host profile can read own row" on public.profiles
  for select to authenticated using (auth.uid()=id);
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles
  for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "Admins manage challenges" on public.daily_challenges;
create policy "Admins manage challenges" on public.daily_challenges for all to authenticated
  using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
  with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "Admins manage questions" on public.questions;
create policy "Admins manage questions" on public.questions for all to authenticated
  using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
  with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.daily_challenges from anon, authenticated;
revoke all on public.questions from anon, authenticated;
revoke all on public.guest_players from anon, authenticated;
revoke all on public.submissions from anon, authenticated;

revoke all on function public.get_daily_challenge() from public;
grant execute on function public.get_daily_challenge() to anon, authenticated;
revoke all on function public.submit_daily_dive(uuid,text,jsonb) from public;
grant execute on function public.submit_daily_dive(uuid,text,jsonb) to anon, authenticated;
revoke all on function public.get_daily_leaderboard(date) from public;
grant execute on function public.get_daily_leaderboard(date) to anon, authenticated;
