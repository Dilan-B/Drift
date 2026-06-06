-- Drift avatar storage setup
-- Run this separately from profile_challenge_updates.sql.
--
-- If Supabase SQL Editor deadlocks while creating storage policies, use the UI:
-- Storage -> New bucket -> name "avatars" -> Public bucket -> 512 KB limit.

set lock_timeout = '5s';
set statement_timeout = '60s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 524288,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Avatar images are public'
  ) then
    execute $policy$
      create policy "Avatar images are public"
      on storage.objects for select
      using (bucket_id = 'avatars')
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users upload own avatar'
  ) then
    execute $policy$
      create policy "Users upload own avatar"
      on storage.objects for insert
      with check (
        bucket_id = 'avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users update own avatar'
  ) then
    execute $policy$
      create policy "Users update own avatar"
      on storage.objects for update
      using (
        bucket_id = 'avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users delete own avatar'
  ) then
    execute $policy$
      create policy "Users delete own avatar"
      on storage.objects for delete
      using (
        bucket_id = 'avatars'
        and auth.uid()::text = (storage.foldername(name))[1]
      )
    $policy$;
  end if;
end $$;

-- Optional cleanup. Run after the bucket setup succeeds, preferably when the app
-- is not actively being tested.
--
-- update public.profiles
-- set avatar_url = null
-- where avatar_url like 'data:image/%';
