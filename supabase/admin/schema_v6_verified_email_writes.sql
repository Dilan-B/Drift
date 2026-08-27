-- Drift schema v6 - require verified email for write/sensitive actions.
-- Run in Supabase SQL Editor after the v3/v4/v5 schema files.
-- Idempotent: safe to run repeatedly.

create or replace function public.current_user_email_confirmed()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

grant execute on function public.current_user_email_confirmed() to authenticated;

-- Profiles: readable for discovery/social UI, but mutable only by verified owner.
do $$ begin
  drop policy if exists "Users can read all profiles" on public.profiles;
  drop policy if exists "Users can update own profile" on public.profiles;
  drop policy if exists "Users can insert own profile" on public.profiles;
  drop policy if exists "profiles: read active" on public.profiles;
  drop policy if exists "profiles: insert own verified" on public.profiles;
  drop policy if exists "profiles: update own verified" on public.profiles;
end $$;

create policy "profiles: read active" on public.profiles
  for select using (deleted_at is null);

create policy "profiles: insert own verified" on public.profiles
  for insert with check (
    auth.uid() = id and public.current_user_email_confirmed()
  );

create policy "profiles: update own verified" on public.profiles
  for update using (
    auth.uid() = id and public.current_user_email_confirmed()
  ) with check (
    auth.uid() = id and public.current_user_email_confirmed()
  );

-- Tasks.
do $$ begin
  drop policy if exists "tasks: own select" on public.tasks;
  drop policy if exists "tasks: own insert" on public.tasks;
  drop policy if exists "tasks: own update" on public.tasks;
end $$;

create policy "tasks: own select" on public.tasks
  for select using (auth.uid() = user_id and deleted_at is null);

create policy "tasks: own insert" on public.tasks
  for insert with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

create policy "tasks: own update" on public.tasks
  for update using (
    auth.uid() = user_id and public.current_user_email_confirmed()
  ) with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

-- Credit ledger is append-only, but inserts still require a verified owner.
do $$ begin
  drop policy if exists "ledger: own select" on public.credit_ledger;
  drop policy if exists "ledger: own insert" on public.credit_ledger;
end $$;

create policy "ledger: own select" on public.credit_ledger
  for select using (auth.uid() = user_id);

create policy "ledger: own insert" on public.credit_ledger
  for insert with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

-- Blocked apps.
do $$ begin
  drop policy if exists "blocked: own select" on public.blocked_apps;
  drop policy if exists "blocked: own insert" on public.blocked_apps;
  drop policy if exists "blocked: own update" on public.blocked_apps;
end $$;

create policy "blocked: own select" on public.blocked_apps
  for select using (auth.uid() = user_id and removed_at is null);

create policy "blocked: own insert" on public.blocked_apps
  for insert with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

create policy "blocked: own update" on public.blocked_apps
  for update using (
    auth.uid() = user_id and public.current_user_email_confirmed()
  ) with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

-- Screen time: public social read remains, writes require verified owner.
do $$ begin
  drop policy if exists "Users can read all screen time" on public.screen_time;
  drop policy if exists "Users can upsert own screen time" on public.screen_time;
  drop policy if exists "screen_time: read active" on public.screen_time;
  drop policy if exists "screen_time: insert own verified" on public.screen_time;
  drop policy if exists "screen_time: update own verified" on public.screen_time;
end $$;

create policy "screen_time: read active" on public.screen_time
  for select using (deleted_at is null);

create policy "screen_time: insert own verified" on public.screen_time
  for insert with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

create policy "screen_time: update own verified" on public.screen_time
  for update using (
    auth.uid() = user_id and public.current_user_email_confirmed()
  ) with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

-- Friendships.
do $$ begin
  drop policy if exists "Users can manage own friendships" on public.friendships;
  drop policy if exists "friendships: read participants" on public.friendships;
  drop policy if exists "friendships: insert own request" on public.friendships;
  drop policy if exists "friendships: only receiver may accept" on public.friendships;
end $$;

create policy "friendships: read participants" on public.friendships
  for select using (
    auth.uid() = user_id or auth.uid() = friend_id
  );

create policy "friendships: insert own request" on public.friendships
  for insert with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

create policy "friendships: only receiver may accept" on public.friendships
  for update using (
    auth.uid() = friend_id and public.current_user_email_confirmed()
  ) with check (
    auth.uid() = friend_id and public.current_user_email_confirmed()
  );

-- Challenges.
do $$ begin
  drop policy if exists "Challenge participants can read" on public.challenges;
  drop policy if exists "Challenger can insert" on public.challenges;
  drop policy if exists "Participants can update" on public.challenges;
  drop policy if exists "challenges: read participants" on public.challenges;
  drop policy if exists "challenges: insert as challenger" on public.challenges;
  drop policy if exists "challenges: update by participants" on public.challenges;
end $$;

create policy "challenges: read participants" on public.challenges
  for select using (
    auth.uid() = challenger_id or auth.uid() = challenged_id
  );

create policy "challenges: insert as challenger" on public.challenges
  for insert with check (
    auth.uid() = challenger_id and public.current_user_email_confirmed()
  );

create policy "challenges: update by participants" on public.challenges
  for update using (
    (auth.uid() = challenger_id or auth.uid() = challenged_id)
    and public.current_user_email_confirmed()
  ) with check (
    (auth.uid() = challenger_id or auth.uid() = challenged_id)
    and public.current_user_email_confirmed()
  );

-- Legacy feedback table, kept for older builds.
do $$ begin
  drop policy if exists "users can insert their own feedback" on public.feedback;
  drop policy if exists "users can read their own feedback" on public.feedback;
end $$;

create policy "users can insert their own feedback" on public.feedback
  for insert with check (
    auth.uid() = user_id and public.current_user_email_confirmed()
  );

create policy "users can read their own feedback" on public.feedback
  for select using (auth.uid() = user_id);

select 'schema_v6_verified_email_writes applied' as status;
