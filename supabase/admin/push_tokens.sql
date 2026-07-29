-- Push token storage for Expo push notifications.
-- Run this in the Supabase SQL editor after the previous schema files.

create table if not exists push_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform        text not null default 'ios',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint push_tokens_user_token_unique unique (user_id, expo_push_token)
);

-- Index for looking up tokens by user (the send-push function queries this).
create index if not exists idx_push_tokens_user_id on push_tokens(user_id);

-- RLS
alter table push_tokens enable row level security;

create policy "Users can insert their own tokens"
  on push_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own tokens"
  on push_tokens for update
  using (auth.uid() = user_id);

create policy "Users can delete their own tokens"
  on push_tokens for delete
  using (auth.uid() = user_id);

create policy "Users can read their own tokens"
  on push_tokens for select
  using (auth.uid() = user_id);

-- Auto-update updated_at on change.
create or replace function update_push_tokens_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_push_tokens_updated_at
  before update on push_tokens
  for each row
  execute function update_push_tokens_updated_at();
