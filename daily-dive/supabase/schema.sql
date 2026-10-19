-- Daily Dive database schema for Supabase (Postgres)
-- Run in Supabase SQL Editor. Row Level Security is enabled on every public table.

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

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  total_score int not null default 0,
  submitted_at timestamptz not null default now(),
  unique(challenge_id,user_id)
);

create index if not exists submissions_challenge_score_idx on public.submissions(challenge_id,total_score desc);
create index if not exists challenges_date_status_idx on public.daily_challenges(challenge_date,status);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id,nickname,role)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nickname',''), split_part(new.email,'@',1)), 'player')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Server-side scoring: accepted answers score more when fewer submitted answers match.
create or replace function public.score_submission()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  q record;
  given text;
  valid_count int;
  total int := 0;
  matched int;
begin
  for q in
    select id, accepted_answers, base_points
    from public.questions where challenge_id = new.challenge_id order by position
  loop
    given := lower(trim(coalesce(new.answers->>q.id::text,'')));
    if given = '' then continue; end if;
    select count(*) into matched from unnest(q.accepted_answers) a where lower(trim(a)) = given;
    if matched > 0 then
      select count(*) into valid_count
      from public.submissions s
      cross join lateral jsonb_each_text(s.answers) a(key,value)
      where s.challenge_id = new.challenge_id and lower(trim(a.value)) = given;
      total := total + greatest(1, floor(q.base_points::numeric / greatest(1, coalesce(valid_count,0)+1))::int);
    end if;
  end loop;
  new.total_score := total;
  return new;
end;
$$;

drop trigger if exists score_submission_before_insert on public.submissions;
create trigger score_submission_before_insert before insert on public.submissions
for each row execute procedure public.score_submission();

alter table public.profiles enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.questions enable row level security;
alter table public.submissions enable row level security;

-- Profile names are readable to signed-in players. Client updates are limited to nickname.
drop policy if exists "Profiles are readable" on public.profiles;
create policy "Profiles are readable" on public.profiles for select to authenticated using (true);
drop policy if exists "Users can create own profile" on public.profiles;
create policy "Users can create own profile" on public.profiles for insert to authenticated with check (auth.uid() = id and role = 'player');
drop policy if exists "Users can update own nickname" on public.profiles;
create policy "Users can update own nickname" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update (nickname) on public.profiles to authenticated;

drop policy if exists "Published challenges are readable" on public.daily_challenges;
create policy "Published challenges are readable" on public.daily_challenges for select to authenticated using (status = 'published' or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));
drop policy if exists "Admins manage challenges" on public.daily_challenges;
create policy "Admins manage challenges" on public.daily_challenges for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "Published questions are readable" on public.questions;
create policy "Published questions are readable" on public.questions for select to authenticated using (exists(select 1 from public.daily_challenges c where c.id=challenge_id and (c.status='published' or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))));
drop policy if exists "Admins manage questions" on public.questions;
create policy "Admins manage questions" on public.questions for all to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

drop policy if exists "Players see own submissions" on public.submissions;
create policy "Players see own submissions" on public.submissions for select to authenticated using (auth.uid()=user_id or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
drop policy if exists "Players submit own answers" on public.submissions;
create policy "Players submit own answers" on public.submissions for insert to authenticated with check (auth.uid()=user_id and exists(select 1 from public.daily_challenges c where c.id=challenge_id and c.status='published'));
drop policy if exists "No client edits to submissions" on public.submissions;
create policy "No client edits to submissions" on public.submissions for update to authenticated using (false);
drop policy if exists "No client deletes to submissions" on public.submissions;
create policy "No client deletes to submissions" on public.submissions for delete to authenticated using (false);

create or replace view public.leaderboard as
select p.nickname, s.total_score, c.challenge_date, s.submitted_at
from public.submissions s
join public.profiles p on p.id=s.user_id
join public.daily_challenges c on c.id=s.challenge_id
where c.status in ('published','closed');

grant select on public.leaderboard to authenticated;
