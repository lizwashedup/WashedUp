-- ============================================================================
-- Next Time! — plan interest signals & creator re-engagement loop
--
-- One-tap signal from a user who can't attend a plan to its creator. Signals
-- surface to the creator on their next plan-creation flow as a warm list of
-- people to invite. Signals are soft-expired (no deletes) under several
-- conditions: explicit removal by the user, the user joining the plan after
-- all, the creator marking "maybe next one" 3 times, the creator inviting
-- the person, blocks between the pair, account deletion, and a 90-day TTL.
--
-- Server impl is DB-only: SECURITY DEFINER RPCs do all writes, and the
-- existing app_notifications fan-out trigger handles push delivery. No
-- new edge functions, no edits to push code.
-- ============================================================================

-- ── 1. Tables ──────────────────────────────────────────────────────────────

create table if not exists public.event_interest_signals (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references public.events(id)   on delete cascade,
  interested_user_id   uuid not null references public.profiles(id) on delete cascade,
  creator_id           uuid not null references public.profiles(id) on delete cascade,
  status               text not null default 'active'
    check (status in ('active','consumed','expired','removed')),
  skip_count           integer not null default 0,
  created_at           timestamptz not null default now(),
  consumed_at          timestamptz,
  consumed_by_event_id uuid references public.events(id) on delete set null,
  expired_at           timestamptz,
  expiry_reason        text
    check (expiry_reason in (
      'skip_limit','time_limit','user_removed','joined',
      'creator_deleted','user_deleted','blocked'
    )),
  unique (event_id, interested_user_id)
);

create index if not exists event_interest_signals_creator_active_idx
  on public.event_interest_signals (creator_id, created_at desc)
  where status = 'active';

create index if not exists event_interest_signals_user_active_idx
  on public.event_interest_signals (interested_user_id, created_at desc)
  where status = 'active';

create index if not exists event_interest_signals_event_active_idx
  on public.event_interest_signals (event_id)
  where status = 'active';

create table if not exists public.event_interest_actions (
  id              uuid primary key default gen_random_uuid(),
  signal_id       uuid not null references public.event_interest_signals(id) on delete cascade,
  action          text not null check (action in ('invite','skip')),
  action_event_id uuid references public.events(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists event_interest_actions_signal_idx
  on public.event_interest_actions (signal_id, created_at desc);

-- ── 2. RLS ─────────────────────────────────────────────────────────────────

alter table public.event_interest_signals enable row level security;
alter table public.event_interest_actions enable row level security;

drop policy if exists "interest_signals_select_own_or_creator"
  on public.event_interest_signals;
create policy "interest_signals_select_own_or_creator"
  on public.event_interest_signals
  for select
  using (
    interested_user_id = auth.uid()
    or (creator_id = auth.uid() and status = 'active')
  );

-- No INSERT/UPDATE/DELETE policies. All writes go through SECURITY DEFINER
-- RPCs which bypass RLS. Direct client writes are silently rejected.

drop policy if exists "interest_actions_select_creator"
  on public.event_interest_actions;
create policy "interest_actions_select_creator"
  on public.event_interest_actions
  for select
  using (
    exists (
      select 1
      from public.event_interest_signals s
      where s.id = signal_id
        and s.creator_id = auth.uid()
    )
  );

-- ── 3. app_notifications type extension ────────────────────────────────────
-- Existing CHECK constraint allows 10 types; add the two new ones.

alter table public.app_notifications
  drop constraint if exists app_notifications_type_check;

alter table public.app_notifications
  add constraint app_notifications_type_check
  check (type = any (array[
    'waitlist_spot','broadcast','event_reminder','member_joined',
    'plan_invite','invite_accepted','new_message','album_ready',
    'plan_cancelled','duplicate_plan',
    'interest_signal','interest_invite'
  ]));

-- ── 4. Helpers ─────────────────────────────────────────────────────────────

-- Mirrors the client-side isPlanPast helper.
create or replace function public._event_is_past(p_start timestamptz, p_end timestamptz)
returns boolean
language sql
immutable
as $$
  select coalesce(p_end, p_start + interval '3 hours') <= now();
$$;

-- Two-way block check using profiles.blocked_users uuid[].
create or replace function public._users_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = p_a and p_b = any(coalesce(blocked_users, '{}'::uuid[]))
  ) or exists (
    select 1 from public.profiles
    where id = p_b and p_a = any(coalesce(blocked_users, '{}'::uuid[]))
  );
$$;

-- ── 5. RPCs ────────────────────────────────────────────────────────────────

create or replace function public.send_interest_signal(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_creator     uuid;
  v_start       timestamptz;
  v_end         timestamptz;
  v_existing    uuid;
  v_signal_id   uuid;
  v_user_name   text;
  v_event_title text;
  v_creator_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select creator_user_id, start_time, end_time, title
    into v_creator, v_start, v_end, v_event_title
  from events
  where id = p_event_id;

  if v_creator is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  if v_creator = v_user_id then
    raise exception 'creators can''t signal interest in their own plan' using errcode = 'P0001';
  end if;

  if _event_is_past(v_start, v_end) then
    raise exception 'this plan has already happened' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from event_members
    where event_id = p_event_id
      and user_id = v_user_id
      and status = 'joined'
  ) then
    raise exception 'you''re already going to this plan' using errcode = 'P0001';
  end if;

  if _users_blocked(v_user_id, v_creator) then
    -- Same friendly opacity as the rest of the app: don't reveal the block.
    raise exception 'this plan isn''t available to you' using errcode = 'P0001';
  end if;

  -- Existing active signal? Idempotent return.
  select id into v_existing
  from event_interest_signals
  where event_id = p_event_id
    and interested_user_id = v_user_id
    and status = 'active';
  if v_existing is not null then
    return v_existing;
  end if;

  insert into event_interest_signals (event_id, interested_user_id, creator_id)
  values (p_event_id, v_user_id, v_creator)
  on conflict (event_id, interested_user_id) do update
    set status = 'active',
        skip_count = 0,
        expired_at = null,
        expiry_reason = null,
        consumed_at = null,
        consumed_by_event_id = null
  returning id into v_signal_id;

  -- Bell + push fan-out via on_app_notification_inserted trigger.
  select first_name_display into v_user_name from profiles where id = v_user_id;
  select first_name_display into v_creator_name from profiles where id = v_creator;
  insert into app_notifications (user_id, type, title, body, event_id)
  values (
    v_creator,
    'interest_signal',
    coalesce(v_user_name, 'Someone') || ' would go next time',
    coalesce(v_user_name, 'Someone') || ' really likes your plan! They can''t make it this time but would love to go next time.',
    p_event_id
  );

  return v_signal_id;
end;
$$;

revoke all on function public.send_interest_signal(uuid) from public;
grant execute on function public.send_interest_signal(uuid) to authenticated;

create or replace function public.act_on_interest(
  p_interested_user_id uuid,
  p_new_event_id       uuid,
  p_action             text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_new_creator    uuid;
  v_signal_count   integer;
  v_primary_signal uuid;
  v_event_title    text;
  v_creator_name   text;
  v_now_expired    integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_action not in ('invite','skip') then
    raise exception 'invalid action: %', p_action using errcode = 'P0001';
  end if;

  select creator_user_id, title into v_new_creator, v_event_title
  from events where id = p_new_event_id;
  if v_new_creator is null or v_new_creator <> v_user_id then
    raise exception 'you can only act on interest for your own plan' using errcode = 'P0001';
  end if;

  -- Count active signals from this person to this creator (across all plans).
  select count(*), max(id) into v_signal_count, v_primary_signal
  from event_interest_signals
  where creator_id = v_user_id
    and interested_user_id = p_interested_user_id
    and status = 'active';

  if v_signal_count = 0 then
    return;  -- Nothing to act on; silently no-op so retries are safe.
  end if;

  if p_action = 'invite' then
    -- Consume ALL active signals from this person to this creator.
    update event_interest_signals
       set status = 'consumed',
           consumed_at = now(),
           consumed_by_event_id = p_new_event_id
     where creator_id = v_user_id
       and interested_user_id = p_interested_user_id
       and status = 'active';

    insert into event_interest_actions (signal_id, action, action_event_id)
    values (v_primary_signal, 'invite', p_new_event_id);

    select first_name_display into v_creator_name from profiles where id = v_user_id;
    insert into app_notifications (user_id, type, title, body, event_id)
    values (
      p_interested_user_id,
      'interest_invite',
      coalesce(v_creator_name, 'A creator') || ' has a new plan',
      coalesce(v_creator_name, 'A creator') || ' is doing something and thought of you. Check it out.',
      p_new_event_id
    );
  else
    -- Skip: log an action row + bump skip_count. If skip_count crosses 3,
    -- expire silently with reason='skip_limit'.
    insert into event_interest_actions (signal_id, action, action_event_id)
    select id, 'skip', p_new_event_id
    from event_interest_signals
    where creator_id = v_user_id
      and interested_user_id = p_interested_user_id
      and status = 'active';

    update event_interest_signals
       set skip_count = skip_count + 1
     where creator_id = v_user_id
       and interested_user_id = p_interested_user_id
       and status = 'active';

    update event_interest_signals
       set status = 'expired',
           expired_at = now(),
           expiry_reason = 'skip_limit'
     where creator_id = v_user_id
       and interested_user_id = p_interested_user_id
       and status = 'active'
       and skip_count >= 3;
  end if;
end;
$$;

revoke all on function public.act_on_interest(uuid, uuid, text) from public;
grant execute on function public.act_on_interest(uuid, uuid, text) to authenticated;

create or replace function public.remove_interest_signal(p_signal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner   uuid;
  v_status  text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select interested_user_id, status into v_owner, v_status
  from event_interest_signals where id = p_signal_id;

  if v_owner is null or v_owner <> v_user_id then
    raise exception 'not your signal' using errcode = '42501';
  end if;
  if v_status <> 'active' then
    return;
  end if;

  update event_interest_signals
     set status = 'removed',
         expired_at = now(),
         expiry_reason = 'user_removed'
   where id = p_signal_id;
end;
$$;

revoke all on function public.remove_interest_signal(uuid) from public;
grant execute on function public.remove_interest_signal(uuid) to authenticated;

-- Returns active signals across all of the caller's past plans, for the
-- "People who want in" section of the plan-creation screen.
create or replace function public.get_creator_interest_signals()
returns table (
  signal_id            uuid,
  interested_user_id   uuid,
  interested_name      text,
  interested_photo_url text,
  origin_event_id      uuid,
  origin_event_title   text,
  created_at           timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.interested_user_id,
    p.first_name_display,
    p.profile_photo_url,
    s.event_id,
    e.title,
    s.created_at
  from event_interest_signals s
  join profiles p on p.id = s.interested_user_id
  join events e   on e.id = s.event_id
  where s.creator_id = auth.uid()
    and s.status = 'active'
  order by s.created_at desc
  limit 50;
$$;

revoke all on function public.get_creator_interest_signals() from public;
grant execute on function public.get_creator_interest_signals() to authenticated;

-- Returns active signals for one specific event the caller created — for
-- the plan detail "Would go next time" creator-only section.
create or replace function public.get_event_interest_signals(p_event_id uuid)
returns table (
  signal_id            uuid,
  interested_user_id   uuid,
  interested_name      text,
  interested_photo_url text,
  created_at           timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.interested_user_id,
    p.first_name_display,
    p.profile_photo_url,
    s.created_at
  from event_interest_signals s
  join events   e on e.id = s.event_id
  join profiles p on p.id = s.interested_user_id
  where s.event_id = p_event_id
    and e.creator_user_id = auth.uid()
    and s.status = 'active'
  order by s.created_at desc;
$$;

revoke all on function public.get_event_interest_signals(uuid) from public;
grant execute on function public.get_event_interest_signals(uuid) to authenticated;

-- Returns the caller's active signals for the Settings management screen.
create or replace function public.get_user_interest_signals()
returns table (
  signal_id        uuid,
  event_id         uuid,
  event_title      text,
  creator_id       uuid,
  creator_name     text,
  created_at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.event_id,
    e.title,
    s.creator_id,
    p.first_name_display,
    s.created_at
  from event_interest_signals s
  join events   e on e.id = s.event_id
  join profiles p on p.id = s.creator_id
  where s.interested_user_id = auth.uid()
    and s.status = 'active'
  order by s.created_at desc;
$$;

revoke all on function public.get_user_interest_signals() from public;
grant execute on function public.get_user_interest_signals() to authenticated;

-- Daily TTL sweep. Idempotent. Returns the row count expired.
create or replace function public.expire_stale_interests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with updated as (
    update event_interest_signals
       set status = 'expired',
           expired_at = now(),
           expiry_reason = 'time_limit'
     where status = 'active'
       and created_at < now() - interval '90 days'
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_interests() from public;
-- Service role / pg_cron only; no grant to authenticated.

-- ── 6. Triggers (all NEW per separate-triggers preference) ────────────────

-- 6a. Auto-expire when the user actually joins the plan.
create or replace function public.expire_interest_on_join()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'joined' then
    return new;
  end if;
  update public.event_interest_signals
     set status = 'expired',
         expired_at = now(),
         expiry_reason = 'joined'
   where event_id = new.event_id
     and interested_user_id = new.user_id
     and status = 'active';
  return new;
end;
$$;

drop trigger if exists trg_expire_interest_on_join_insert on public.event_members;
create trigger trg_expire_interest_on_join_insert
  after insert on public.event_members
  for each row
  execute function public.expire_interest_on_join();

drop trigger if exists trg_expire_interest_on_join_update on public.event_members;
create trigger trg_expire_interest_on_join_update
  after update of status on public.event_members
  for each row
  when (old.status is distinct from 'joined'::member_status
        and new.status = 'joined'::member_status)
  execute function public.expire_interest_on_join();

-- 6b. Expire signals between any pair when a block lands. Only acts on
-- newly-added blocks (diff old vs new array) so re-saves of unrelated
-- profile fields don't churn signals.
create or replace function public.expire_interests_on_block()
returns trigger
language plpgsql
as $$
declare
  v_old uuid[] := coalesce(old.blocked_users, '{}'::uuid[]);
  v_new uuid[] := coalesce(new.blocked_users, '{}'::uuid[]);
  v_added uuid[];
begin
  -- Newly-added user ids only.
  select array_agg(x) into v_added from unnest(v_new) x where not (x = any(v_old));
  if v_added is null or array_length(v_added, 1) is null then
    return new;
  end if;

  update public.event_interest_signals
     set status = 'expired',
         expired_at = now(),
         expiry_reason = 'blocked'
   where status = 'active'
     and (
       (interested_user_id = new.id and creator_id = any(v_added))
       or (creator_id = new.id and interested_user_id = any(v_added))
     );
  return new;
end;
$$;

drop trigger if exists trg_expire_interests_on_block on public.profiles;
create trigger trg_expire_interests_on_block
  after update of blocked_users on public.profiles
  for each row
  when (old.blocked_users is distinct from new.blocked_users)
  execute function public.expire_interests_on_block();

-- 6c. Account deletion cleanup — covered by FK cascades on the table itself,
-- but we want the soft-status audit trail before the rows vanish, so run
-- BEFORE DELETE on profiles and stamp signals first.
create or replace function public.expire_interests_on_profile_delete()
returns trigger
language plpgsql
as $$
begin
  update public.event_interest_signals
     set status = 'expired',
         expired_at = now(),
         expiry_reason = 'creator_deleted'
   where status = 'active'
     and creator_id = old.id;
  update public.event_interest_signals
     set status = 'expired',
         expired_at = now(),
         expiry_reason = 'user_deleted'
   where status = 'active'
     and interested_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_expire_interests_on_profile_delete on public.profiles;
create trigger trg_expire_interests_on_profile_delete
  before delete on public.profiles
  for each row
  execute function public.expire_interests_on_profile_delete();

-- ── 7. Embedded smoke test ─────────────────────────────────────────────────
-- Per `supabase branches broken` memory: validate inside the migration so
-- we don't depend on Supabase preview branches. End-to-end RPC tests would
-- require a real auth context (auth.uid() reads from a request GUC) and
-- fixture profiles that satisfy validate_profile_data — both fragile in a
-- migration context. Instead, smoke-test that every promised object exists
-- and the type CHECK extension actually accepts the new values.

do $$
declare
  v_missing text;
begin
  -- 7a. Tables.
  if to_regclass('public.event_interest_signals') is null then
    raise exception 'event_interest_signals table missing';
  end if;
  if to_regclass('public.event_interest_actions') is null then
    raise exception 'event_interest_actions table missing';
  end if;

  -- 7b. RPCs and helpers.
  for v_missing in
    select unnest(array[
      'send_interest_signal','act_on_interest','remove_interest_signal',
      'get_creator_interest_signals','get_event_interest_signals',
      'get_user_interest_signals','expire_stale_interests',
      '_event_is_past','_users_blocked',
      'expire_interest_on_join','expire_interests_on_block',
      'expire_interests_on_profile_delete'
    ])
  loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_missing
    ) then
      raise exception 'function public.% missing', v_missing;
    end if;
  end loop;

  -- 7c. Triggers.
  for v_missing in
    select unnest(array[
      'trg_expire_interest_on_join_insert',
      'trg_expire_interest_on_join_update',
      'trg_expire_interests_on_block',
      'trg_expire_interests_on_profile_delete'
    ])
  loop
    if not exists (
      select 1 from pg_trigger where tgname = v_missing and not tgisinternal
    ) then
      raise exception 'trigger % missing', v_missing;
    end if;
  end loop;

  -- 7d. Helper purity check (no DB state needed).
  if _event_is_past(now() - interval '1 day', null) is not true then
    raise exception '_event_is_past should report past for 1d-old start_time';
  end if;
  if _event_is_past(now() + interval '1 day', null) is true then
    raise exception '_event_is_past should report future for 1d-out start_time';
  end if;

  -- 7e. app_notifications type CHECK includes the new values. Verify by
  -- reading the constraint definition rather than inserting fixture rows
  -- (which would trip FK to profiles and fire the push fan-out trigger).
  declare
    v_def text;
  begin
    select pg_get_constraintdef(c.oid) into v_def
      from pg_constraint c
      join pg_class cls on cls.oid = c.conrelid
      join pg_namespace n on n.oid = cls.relnamespace
     where n.nspname = 'public'
       and cls.relname = 'app_notifications'
       and c.conname = 'app_notifications_type_check';
    if v_def is null then
      raise exception 'app_notifications_type_check constraint missing';
    end if;
    if v_def not like '%interest_signal%' then
      raise exception 'app_notifications type CHECK does not include interest_signal';
    end if;
    if v_def not like '%interest_invite%' then
      raise exception 'app_notifications type CHECK does not include interest_invite';
    end if;
    -- Sanity: previous types must still be there (no regression).
    if v_def not like '%member_joined%' or v_def not like '%new_message%' then
      raise exception 'app_notifications type CHECK regressed existing types: %', v_def;
    end if;
  end;

  raise notice 'event_interest_signals migration smoke test PASSED';
end;
$$;

-- ============================================================================
-- pg_cron scheduling NOT applied here. Schedule with a separate command
-- once cron extension state is verified:
--   select cron.schedule('expire-stale-interests','0 9 * * *',
--                        $$select public.expire_stale_interests()$$);
-- ============================================================================
