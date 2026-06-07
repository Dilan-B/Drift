-- ── Drift Feedback Table ────────────────────────────────────
-- Run once in Supabase SQL editor. Lets the in-app "Send feedback"
-- button insert reports straight into Postgres, with RLS so users
-- can only see/insert their own rows.

create table if not exists public.feedback (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 5000),
  app_version text,
  platform    text,
  os_version  text,
  created_at  timestamptz default now()
);

alter table public.feedback enable row level security;

drop policy if exists "users can insert their own feedback" on public.feedback;
create policy "users can insert their own feedback"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can read their own feedback" on public.feedback;
create policy "users can read their own feedback"
  on public.feedback for select
  to authenticated
  using (auth.uid() = user_id);

-- Index for "show me my last 30 days" reads
create index if not exists feedback_user_created_idx
  on public.feedback (user_id, created_at desc);
