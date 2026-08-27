-- ────────────────────────────────────────────────────────────
-- Drift schema v12 — First-account welcome bonus (30 minutes)
--
-- New accounts start with 30 minutes (1800 s) of screen time already
-- banked, so a first-time user isn't staring at a locked phone before
-- they've completed anything.
--
-- Granted EXACTLY ONCE, server-side, at profile creation:
--   * profiles.balance_seconds is seeded to 1800 on the initial insert.
--   * a credit_ledger row (+30, reason 'welcome_bonus') is appended, but
--     only if the user has never received one — so a reinstall, a new
--     device, or a re-run of this migration cannot re-grant it.
--
-- Units note (matches the rest of the app):
--   * balance_seconds is in SECONDS  → 1800  = 30 min live screen time.
--   * credit_ledger.delta is in MINUTES/credits → 30.
--
-- Idempotent. Safe to re-run. Run once in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- Redefine handle_new_user to (a) keep the existing username logic and
-- (b) seed the welcome balance + one-time ledger entry.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  desired text;
  candidate text;
  tries int := 0;
  welcome_seconds constant int := 1800;  -- 30 minutes
  welcome_credits constant int := 30;     -- 30 minutes, in ledger units
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
      insert into public.profiles (id, username, full_name, balance_seconds)
      values (
        new.id,
        candidate,
        coalesce(new.raw_user_meta_data->>'full_name', candidate),
        welcome_seconds
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
            insert into public.profiles (id, username, full_name, balance_seconds)
            values (new.id, candidate, coalesce(new.raw_user_meta_data->>'full_name', candidate), welcome_seconds)
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

  -- One-time welcome bonus in the append-only ledger. The NOT EXISTS guard
  -- makes this idempotent: it will never grant a second bonus, even if the
  -- profile row already existed (on-conflict-do-nothing above).
  begin
    insert into public.credit_ledger (user_id, delta, reason, balance_after)
    select new.id, welcome_credits, 'welcome_bonus', welcome_credits
    where not exists (
      select 1 from public.credit_ledger
      where user_id = new.id and reason = 'welcome_bonus'
    );
  exception when others then
    -- Never block signup on the bonus; the balance_seconds seed above still
    -- gives them their 30 minutes even if the ledger write hiccups.
    raise warning 'welcome_bonus grant failed for %: %', new.id, sqlerrm;
  end;

  return new;
end; $$;

-- Verify: the function compiles and the trigger is still attached.
select
  tgname   as trigger_name,
  proname  as function_name
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgname = 'on_auth_user_created';
