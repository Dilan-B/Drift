-- analytics_events.sql
-- Lightweight event logging table for product analytics.
-- Run this in the Supabase SQL editor.

create table if not exists public.analytics_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  properties jsonb default '{}',
  device_info jsonb default '{}',
  created_at timestamptz not null default now()
);

-- Index for querying events by name over time ranges.
create index if not exists idx_analytics_events_name_created
  on public.analytics_events (event_name, created_at);

-- Index for per-user event lookups.
create index if not exists idx_analytics_events_user
  on public.analytics_events (user_id, created_at);

-- RLS: users can insert their own events, nothing else.
alter table public.analytics_events enable row level security;

create policy "Users can insert own events"
  on public.analytics_events
  for insert
  with check (auth.uid() = user_id);

-- No select/update/delete policies — analysis is done server-side
-- via the service-role key or directly in the Supabase dashboard.
