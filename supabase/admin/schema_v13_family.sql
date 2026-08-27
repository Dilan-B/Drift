-- ────────────────────────────────────────────────────────────
-- Drift schema v13 — Family accounts (parent / child / personal)
--
-- Adds the data model for the family feature:
--   * profiles.account_type ('personal' | 'parent' | 'child'), IMMUTABLE once set.
--   * families (a parent owns one, identified by a short shareable code).
--   * family_members (children linked to a family, with a per-child app policy).
--   * tasks columns for parent-assigned / approval-gated tasks.
--   * cross-account RLS so a parent can READ their children's tasks/profiles
--     (all cross-account WRITES stay service-role-only via edge functions).
--   * handle_new_user branches by account_type:
--       personal → 30-min welcome bonus (unchanged)
--       parent   → no bonus, auto-create a family + unique code
--       child    → no bonus, balance starts at 0
--
-- DEPENDS ON schema_v3 (profiles/tasks/credit_ledger, prevent_hard_delete) and
-- schema_v12 (welcome-bonus handle_new_user). Idempotent. Run in the SQL editor.
-- ────────────────────────────────────────────────────────────

-- ── 1. profiles.account_type (immutable) ─────────────────────
alter table public.profiles
  add column if not exists account_type text not null default 'personal';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_account_type_chk'
  ) then
    alter table public.profiles
      add constraint profiles_account_type_chk
      check (account_type in ('personal','parent','child'));
  end if;
end $$;

-- Lock it: account_type can NEVER change after creation (no personal→parent,
-- child→personal, etc.). Fires for every writer including the service role —
-- triggers are not bypassed by RLS — so this is a true hard lock.
create or replace function public.prevent_account_type_change() returns trigger
language plpgsql as $$
begin
  if new.account_type is distinct from old.account_type then
    raise exception 'account_type is immutable and cannot be changed after account creation';
  end if;
  return new;
end; $$;

drop trigger if exists profiles_account_type_lock on public.profiles;
create trigger profiles_account_type_lock before update on public.profiles
  for each row execute function public.prevent_account_type_change();

-- ── 2. tasks: parent-assignment + approval columns ───────────
-- All nullable/defaulted so existing personal tasks are unaffected.
alter table public.tasks
  add column if not exists assigned_by      uuid references auth.users,
  add column if not exists requires_approval boolean not null default false,
  add column if not exists status           text;  -- 'assigned'|'submitted'|'approved'|'rejected' (null = personal task)

-- ── 3. families ──────────────────────────────────────────────
create table if not exists public.families (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null references auth.users on delete cascade,
  code       text not null unique,           -- short, uppercase, opaque
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.families enable row level security;
grant select on public.families to authenticated;

-- ── 4. family_members ────────────────────────────────────────
create table if not exists public.family_members (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null check (role in ('parent','child')),
  display_name text,
  app_policy   jsonb not null default '{"mode":"categories","allow":[]}'::jsonb,
  joined_at    timestamptz not null default now(),
  removed_at   timestamptz,                    -- soft delete
  unique (family_id, user_id)
);
alter table public.family_members enable row level security;
grant select on public.family_members to authenticated;

create index if not exists family_members_family on public.family_members (family_id) where removed_at is null;
create index if not exists family_members_user   on public.family_members (user_id)   where removed_at is null;

-- ── 5. SECURITY DEFINER helpers (avoid RLS recursion across tables) ──
-- Caller is the parent (owner) of the given family.
create or replace function public.is_family_parent(fam uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.families
    where id = fam and parent_id = auth.uid() and deleted_at is null
  );
$$;

-- Caller is an active member of the given family (parent or child).
create or replace function public.is_family_member(fam uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members
    where family_id = fam and user_id = auth.uid() and removed_at is null
  );
$$;

-- Caller is the parent of the given child user (share an active family where
-- caller is the parent-owner and child_uid is an active child member).
create or replace function public.is_parent_of(child_uid uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1
    from public.family_members cm
    join public.families f on f.id = cm.family_id
    where cm.user_id = child_uid
      and cm.role = 'child'
      and cm.removed_at is null
      and f.parent_id = auth.uid()
      and f.deleted_at is null
  );
$$;

grant execute on function public.is_family_parent(uuid) to authenticated;
grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.is_parent_of(uuid)     to authenticated;

-- Param-based link check for EDGE FUNCTIONS (they run with the service role, so
-- auth.uid() is null — is_parent_of() can't be used there). Verifies that
-- parent_uid owns child_uid.
create or replace function public.parent_owns_child(parent_uid uuid, child_uid uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1
    from public.family_members cm
    join public.families f on f.id = cm.family_id
    where cm.user_id = child_uid
      and cm.role = 'child'
      and cm.removed_at is null
      and f.parent_id = parent_uid
      and f.deleted_at is null
  );
$$;

-- Atomic screen-time grant: append the ledger entry AND bump balance_seconds in
-- one call so a parent grant can't race the child's own drain sync. Called by
-- the approve-child-task edge function (service role). Returns the new balance.
create or replace function public.grant_screen_time(child_uid uuid, secs int, mins int, ref uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  new_balance int;
begin
  insert into public.credit_ledger (user_id, delta, reason, ref_id, balance_after)
  values (child_uid, mins, 'parent_grant', ref, null);

  update public.profiles
    set balance_seconds = greatest(0, balance_seconds + secs)
    where id = child_uid
    returning balance_seconds into new_balance;

  return coalesce(new_balance, 0);
end; $$;

-- ── 6. RLS policies ──────────────────────────────────────────
-- families: readable by its parent or any active member. Writes: service-role only.
do $$ begin
  drop policy if exists "families: read own" on public.families;
end $$;
create policy "families: read own" on public.families
  for select using (
    parent_id = auth.uid() or public.is_family_member(id)
  );

-- family_members: a user sees their own membership; a parent sees all members
-- of families they own. Writes: service-role only.
do $$ begin
  drop policy if exists "family_members: read own or as parent" on public.family_members;
end $$;
create policy "family_members: read own or as parent" on public.family_members
  for select using (
    user_id = auth.uid() or public.is_family_parent(family_id)
  );

-- tasks: ADD a parent read path (on top of the existing "tasks: own select").
-- Lets a parent see + get realtime for their children's tasks (assignment shows
-- as their own row to the child; submission/approval visible to the parent).
-- Writes to a child's tasks remain service-role only — do NOT widen inserts/updates.
do $$ begin
  drop policy if exists "tasks: parent select" on public.tasks;
end $$;
create policy "tasks: parent select" on public.tasks
  for select using (
    deleted_at is null and public.is_parent_of(user_id)
  );

-- profiles: a parent may read their child's row (name + balance_seconds for the
-- dashboard). NOTE the existing "profiles: read active" (schema_v6) already
-- permits reading non-deleted profiles; this is an explicit, narrower guarantee
-- that survives any future tightening of that broad policy.
do $$ begin
  drop policy if exists "profiles: parent read child" on public.profiles;
end $$;
create policy "profiles: parent read child" on public.profiles
  for select using (
    deleted_at is null and public.is_parent_of(id)
  );

-- ── 7. Extend the no-hard-delete guard to the new tables ─────
do $$
declare
  t text;
  guarded text[] := array['families', 'family_members'];
begin
  foreach t in array guarded loop
    execute format('drop trigger if exists no_hard_delete on public.%I', t);
    execute format('create trigger no_hard_delete before delete on public.%I for each row execute function public.prevent_hard_delete()', t);
  end loop;
end $$;

-- ── 8. Family-code generator ─────────────────────────────────
-- 6 chars from an unambiguous alphabet (no I/L/O/0/1). ~31^6 ≈ 887M combos.
create or replace function public.gen_family_code()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random()*31)::int) + 1, 1),
    ''
  )
  from generate_series(1, 6);
$$;

-- ── 9. handle_new_user — branch by account_type ──────────────
-- personal → 30-min welcome bonus (unchanged from v12)
-- parent   → no bonus; auto-create a family with a unique code
-- child    → no bonus; balance starts at 0
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  desired text;
  candidate text;
  tries int := 0;
  welcome_seconds constant int := 1800;   -- 30 minutes
  welcome_credits constant int := 30;      -- 30 minutes, in ledger units
  acct_type text := lower(coalesce(nullif(trim(new.raw_user_meta_data->>'account_type'), ''), 'personal'));
  is_personal boolean;
  start_balance int;
  fam_code text;
  code_tries int := 0;
begin
  if acct_type not in ('personal','parent','child') then
    acct_type := 'personal';
  end if;
  is_personal := (acct_type = 'personal');
  -- Only personal accounts get the welcome balance; parents are management-only
  -- and children earn strictly via parent approval.
  start_balance := case when is_personal then welcome_seconds else 0 end;

  desired := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    'drifter' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8))
  );
  desired := lower(regexp_replace(desired, '[^a-zA-Z0-9_]', '', 'g'));
  if length(desired) < 3 then
    desired := 'drifter' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  end if;
  desired := substr(desired, 1, 20);
  candidate := desired;

  loop
    begin
      insert into public.profiles (id, username, full_name, balance_seconds, account_type)
      values (
        new.id,
        candidate,
        coalesce(new.raw_user_meta_data->>'full_name', candidate),
        start_balance,
        acct_type
      )
      on conflict (id) do nothing;
      exit;
    exception
      when unique_violation then
        tries := tries + 1;
        if tries >= 20 then
          candidate := 'drifter' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
          begin
            insert into public.profiles (id, username, full_name, balance_seconds, account_type)
            values (new.id, candidate, coalesce(new.raw_user_meta_data->>'full_name', candidate), start_balance, acct_type)
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

  -- Welcome bonus: personal accounts only, exactly once.
  if is_personal then
    begin
      insert into public.credit_ledger (user_id, delta, reason, balance_after)
      select new.id, welcome_credits, 'welcome_bonus', welcome_credits
      where not exists (
        select 1 from public.credit_ledger
        where user_id = new.id and reason = 'welcome_bonus'
      );
    exception when others then
      raise warning 'welcome_bonus grant failed for %: %', new.id, sqlerrm;
    end;
  end if;

  -- Parent: create their family with a unique join code.
  if acct_type = 'parent' then
    begin
      loop
        fam_code := public.gen_family_code();
        begin
          insert into public.families (parent_id, code) values (new.id, fam_code);
          exit;
        exception when unique_violation then
          code_tries := code_tries + 1;
          if code_tries >= 10 then
            -- fall back to a longer code to guarantee termination
            fam_code := public.gen_family_code() || public.gen_family_code();
            insert into public.families (parent_id, code) values (new.id, fam_code)
            on conflict do nothing;
            exit;
          end if;
        end;
      end loop;
    exception when others then
      raise warning 'family creation failed for parent %: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end; $$;

-- ── 10. Realtime: parent↔child live updates need tasks in the publication ──
-- profiles is already published (SocialScreen subscribes to it); add tasks.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  -- family_members so a parent sees a kid appear the moment they join (no refresh).
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'family_members'
  ) then
    alter publication supabase_realtime add table public.family_members;
  end if;
end $$;

-- ── 11. Verify ───────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='families')
    then raise exception 'families table missing'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='family_members')
    then raise exception 'family_members table missing'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='profiles' and column_name='account_type')
    then raise exception 'profiles.account_type missing'; end if;
end $$;

select 'schema_v13_family applied — '
  || (select count(*) from public.families)::text || ' families' as status;
