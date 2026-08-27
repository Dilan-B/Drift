-- ────────────────────────────────────────────────────────────
-- Drift schema v4 — Authorization hardening
-- Closes IDOR + replay vulnerabilities from the round-2 security audit.
-- Idempotent. Run in Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────


-- ── 1. CHALLENGES — add full RLS (was missing entirely) ──
alter table public.challenges enable row level security;

do $$ begin
  drop policy if exists "challenges: read participants" on public.challenges;
  drop policy if exists "challenges: insert as challenger" on public.challenges;
  drop policy if exists "challenges: challenger may cancel" on public.challenges;
  drop policy if exists "challenges: challenged may respond" on public.challenges;
  drop policy if exists "challenges: both may report progress" on public.challenges;
  drop policy if exists "challenges: update by participants" on public.challenges;
end $$;

create policy "challenges: read participants" on public.challenges
  for select using (
    auth.uid() = challenger_id or auth.uid() = challenged_id
  );

create policy "challenges: insert as challenger" on public.challenges
  for insert with check (auth.uid() = challenger_id);

create policy "challenges: update by participants" on public.challenges
  for update using (
    auth.uid() = challenger_id or auth.uid() = challenged_id
  );

-- No DELETE — soft delete only (cancelled_at / status='cancelled')


-- ── 2. FRIENDSHIPS — split policies so requester can't auto-accept ──
do $$ begin
  drop policy if exists "Users can manage own friendships" on public.friendships;
  drop policy if exists "friendships: read participants" on public.friendships;
  drop policy if exists "friendships: insert own request" on public.friendships;
  drop policy if exists "friendships: requester may cancel" on public.friendships;
  drop policy if exists "friendships: only receiver may accept" on public.friendships;
end $$;

create policy "friendships: read participants" on public.friendships
  for select using (
    auth.uid() = user_id or auth.uid() = friend_id
  );

create policy "friendships: insert own request" on public.friendships
  for insert with check (auth.uid() = user_id);

create policy "friendships: only receiver may accept" on public.friendships
  for update using (auth.uid() = friend_id);


-- ── 3. STRIPE WEBHOOK IDEMPOTENCY — dedupe table ──
create table if not exists public.webhook_events (
  id            text primary key,           -- Stripe's event.id (evt_…)
  event_type    text not null,
  user_id       uuid,
  processed_at  timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
-- No RLS policies — service-role only. Clients can never read this.


-- ── 4. TRIAL CLAIM — also gate by user_id ──
alter table public.trial_ip_log
  add column if not exists user_id uuid references auth.users on delete set null;

create index if not exists trial_ip_log_user_id
  on public.trial_ip_log (user_id);


-- ── 5. VERIFY ──
select 'schema_v4_authz_hardening applied' as status;
