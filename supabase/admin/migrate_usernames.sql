-- ────────────────────────────────────────────────────────────
-- Drift — Migrate auto-generated "drifter…" usernames to use
-- whatever full_name the user signed up with. Run once in
-- Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- 1. Update the trigger so future signups use the supplied username
--    from raw_user_meta_data (sent by the client).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  desired text;
  candidate text;
  tries int := 0;
begin
  -- The client passes 'username' in user_metadata (preferred).
  -- Fallback: full_name. Final fallback: random drifter-XXXXXXXX.
  desired := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    'drifter' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
  );

  -- Normalize: lowercase, only alphanumeric + underscore, max 20 chars
  desired := lower(regexp_replace(desired, '[^a-zA-Z0-9_]', '', 'g'));
  if length(desired) < 3 then
    desired := 'drifter' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  end if;
  desired := substr(desired, 1, 20);

  candidate := desired;

  -- Try the desired name first; on collision, append _2, _3, …
  loop
    begin
      insert into public.profiles (id, username, full_name)
      values (
        new.id,
        candidate,
        coalesce(new.raw_user_meta_data->>'full_name', candidate)
      )
      on conflict (id) do nothing;
      exit;
    exception
      when unique_violation then
        tries := tries + 1;
        if tries >= 20 then
          -- After 20 tries, give up and use a random one
          candidate := 'drifter' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
          begin
            insert into public.profiles (id, username, full_name)
            values (new.id, candidate, coalesce(new.raw_user_meta_data->>'full_name', candidate))
            on conflict (id) do nothing;
          exception when others then null;
          end;
          exit;
        end if;
        candidate := substr(desired, 1, 18) || '_' || (tries + 1);
      when others then
        raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
        exit;
    end;
  end loop;

  return new;
end; $$;

-- 2. Backfill existing "drifter…" usernames using their full_name if set.
--    Only updates rows whose username matches the auto-generated pattern.
do $$
declare
  r record;
  base_name text;
  candidate text;
  attempt int;
  ok boolean;
begin
  for r in
    select p.id, p.username, p.full_name, u.email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.username like 'drifter%'
      and (
        coalesce(nullif(trim(p.full_name), ''), '') <> ''
        or coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), '') <> ''
      )
  loop
    base_name := coalesce(
      nullif(trim(r.full_name), ''),
      nullif(trim((select raw_user_meta_data->>'full_name' from auth.users where id = r.id)), '')
    );
    base_name := lower(regexp_replace(base_name, '[^a-zA-Z0-9_]', '', 'g'));
    if length(base_name) < 3 then
      continue; -- skip — keep their drifter… username
    end if;
    base_name := substr(base_name, 1, 20);

    candidate := base_name;
    attempt := 0;
    ok := false;

    while not ok and attempt < 20 loop
      begin
        update public.profiles set username = candidate where id = r.id;
        ok := true;
      exception when unique_violation then
        attempt := attempt + 1;
        candidate := substr(base_name, 1, 18) || '_' || (attempt + 1);
      end;
    end loop;
  end loop;
end $$;

-- 3. Verify result
select username, full_name from profiles order by updated_at desc limit 10;
