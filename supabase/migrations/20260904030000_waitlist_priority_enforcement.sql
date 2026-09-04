-- ══════════════════════════════════════════════════════════════════════
-- Waitlist priority enforcement (2026-09-04)
--
-- Liz reported a real production incident (WhatsApp, 2026-09-04): a spot
-- opened on her brunch plan, the waitlisted girls were never given real
-- priority, and the spot "seems to be going just to public." Her stated
-- intent: when a spot opens, the waitlist should get first crack at it,
-- first to respond gets it, and only after nobody claims it should it
-- open to the general public.
--
-- Root cause, traced through the real trigger chain already in this repo:
--   event_members.status -> 'left' fires notify_waitlist_on_spot_open()
--   (20260401000000_fix_full_status_bugs.sql), which queues a row per
--   waitlisted user into waitlist_notification_queue and marks them
--   notified. That insert fires create_waitlist_spot_notification()
--   (20260501000001, latest version), which creates a real
--   app_notifications row of type 'waitlist_spot' with a proximity-based
--   expiry window ("A spot opened up! ... Claim it before someone else
--   does!").
--
--   That whole pipeline only ever sends a NOTIFICATION. Nothing anywhere
--   enforced it. join_event_atomic -- the one RPC that actually grants a
--   seat (called from app/plan/[id].tsx) -- only ever checked raw
--   capacity. Any authenticated user, waitlisted or not, could call it
--   the instant a seat opened and win the race, with zero priority for
--   whoever the notification was actually for. That's the bug: the
--   "notify" half of the feature was wired up, the "priority" half never
--   was.
--
-- Fix: join_event_atomic now checks, once capacity clears, whether this
-- event currently has an active (unread, unexpired) waitlist_spot
-- notification held by someone OTHER than the caller. If so, and the
-- caller doesn't hold one of their own, the seat is reserved and the
-- caller is turned away with a new distinct return value
-- ('waitlist_priority') instead of silently let in. Once every active
-- notification for the event expires (the existing dynamic timeout --
-- 4h/2h/0h by proximity, already shipped in create_waitlist_spot_notification),
-- the seat opens to the public exactly as before. A user who DOES hold an
-- active notification for this event can always join -- whichever
-- notified waitlister responds first wins the atomic capacity race
-- underneath, matching "first one to respond gets the spot."
--
-- Scope: this only touches join_event_atomic (the Plans / event_waitlist
-- path Liz's screenshot is actually on -- "Waitlist (2)", "1 spot left").
-- join_circle_plan_atomic uses a completely different capacity model
-- (per-circle stranger_cap, no event_waitlist involvement at all) and is
-- deliberately left untouched here -- extending this there would be new
-- scope nobody asked for.
--
-- NOT independently verified here: whether push delivery itself reached
-- the specific waitlisted users in Liz's real incident. The insert into
-- app_notifications and the generic push trigger
-- (on_app_notification_inserted, 20260309000000) are unconditional on
-- notification type, so nothing in the code excludes 'waitlist_spot' --
-- but confirming an actual push was sent and received needs real
-- delivery logs this session doesn't have, not more code reading. This
-- migration fixes the definite, code-verified bug: no priority was ever
-- enforced at the one place a seat actually changes hands.
--
-- HELD, not applied: no local Supabase sandbox was available this
-- session (auth.users/auth.uid() aren't provisioned by a bare
-- postgres:17-alpine container, so the self-test below needs a real
-- Supabase-shaped database to run). Needs a real local/staging
-- apply-and-test pass before Josh reviews it for production. See
-- docs/database/migration-provenance.json for the formal hold record.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION join_event_atomic(
  p_event_id uuid,
  p_user_id uuid,
  p_age_at_join int DEFAULT NULL,
  p_gender_at_join text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event RECORD;
  v_member_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'can only join as yourself';
  END IF;

  -- Lock the event row to prevent concurrent updates
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;

  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF v_event.status = 'full' THEN
    RETURN 'full';
  END IF;

  -- Re-check actual member count inside the transaction
  SELECT count(*)::int INTO v_member_count
  FROM event_members
  WHERE event_id = p_event_id AND status = 'joined';

  -- Capacity = max_invites + 1 (creator counts as a member in event_members)
  IF v_member_count > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
    RETURN 'full';
  END IF;

  -- Waitlist priority window: a seat is open. If someone else on the
  -- waitlist currently holds an active, unexpired claim on it and this
  -- caller does not hold one of their own, the seat is reserved for them
  -- -- turn the caller away instead of letting the general public win
  -- the race. A caller who does hold an active claim always proceeds,
  -- regardless of how many other waitlisters are also active: whichever
  -- of them calls this first wins the capacity check below.
  IF EXISTS (
    SELECT 1 FROM app_notifications
    WHERE event_id = p_event_id
      AND type = 'waitlist_spot'
      AND status = 'unread'
      AND expires_at > now()
      AND user_id <> p_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM app_notifications
    WHERE event_id = p_event_id
      AND type = 'waitlist_spot'
      AND status = 'unread'
      AND expires_at > now()
      AND user_id = p_user_id
  ) THEN
    RETURN 'waitlist_priority';
  END IF;

  -- Insert or update the member (re-join if previously left)
  UPDATE event_members
  SET status = 'joined', role = 'guest',
      age_at_join = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  -- If the plan is now full, update its status
  IF (v_member_count + 1) > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
  END IF;

  RETURN 'joined';
END;
$function$;

-- ----------------------------------------------------------------------------
-- SELF-TEST (house style per explore_event_rsvp_capacity.sql /
-- circle_plan_join_role_cast_fix.sql): real existing non-admin users,
-- explicit cleanup, exercises the REAL existing trigger chain (leaving a
-- plan really fires notify_waitlist_on_spot_open ->
-- create_waitlist_spot_notification, not a hand-faked notification row)
-- so this proves the fix against the actual production pipeline, not a
-- mock of it.
--
-- Scenario 1 (priority window active): Bob leaves a 1-max_invites plan
-- Alice created; the real trigger notifies waitlisted Cara. Dave (an
-- uninvolved bystander -- "the public") tries to join and must be turned
-- away with 'waitlist_priority'. Cara then tries and must get 'joined'.
--
-- Scenario 2 (window expired): same shape with Dave as creator, Alice as
-- the leaver, Bob as the waitlister. After the real trigger notifies Bob,
-- his notification is manually expired (simulating the timeout that
-- already ships in create_waitlist_spot_notification). Cara -- the
-- bystander this time -- must now be allowed to join, proving "if no one
-- replies, back to public."
--
-- NOT covered here: two literally concurrent transactions racing the
-- same freed seat. The FOR UPDATE lock on the parent events row (already
-- shipped, unchanged by this migration) is what makes that race safe --
-- a structural Postgres guarantee, not something added here.
-- ----------------------------------------------------------------------------

do $selftest$
declare
  v_admin_role text := current_user;
  v_alice uuid;
  v_bob uuid;
  v_cara uuid;
  v_dave uuid;
  v_ev1 uuid;
  v_ev2 uuid;
  v_result text;
begin
  select id into v_alice from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_bob from auth.users u
  where u.id <> v_alice
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_cara from auth.users u
  where u.id not in (v_alice, v_bob)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_dave from auth.users u
  where u.id not in (v_alice, v_bob, v_cara)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_alice is null or v_bob is null or v_cara is null or v_dave is null then
    raise exception 'SELFTEST FAIL: needs four existing non-admin users';
  end if;

  -- ══════════ Scenario 1: priority window active ══════════
  insert into events (creator_user_id, title, start_time, max_invites, status)
  values (v_alice, 'selftest waitlist priority: active window', now() + interval '5 days', 1, 'forming')
  returning id into v_ev1;

  insert into event_members (event_id, user_id, role, status)
  values (v_ev1, v_alice, 'host', 'joined'), (v_ev1, v_bob, 'guest', 'joined');

  insert into event_waitlist (event_id, user_id) values (v_ev1, v_cara);

  -- Bob leaves for real: this must fire the actual production trigger
  -- chain (notify_waitlist_on_spot_open -> waitlist_notification_queue
  -- -> create_waitlist_spot_notification -> app_notifications).
  update event_members set status = 'left' where event_id = v_ev1 and user_id = v_bob;

  if not exists (
    select 1 from app_notifications
    where event_id = v_ev1 and user_id = v_cara and type = 'waitlist_spot' and status = 'unread'
  ) then
    raise exception 'SELFTEST FAIL: the existing notify_waitlist_on_spot_open trigger chain did not notify Cara -- cannot test enforcement without it';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_dave, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.join_event_atomic(v_ev1, v_dave) into v_result;
  if v_result <> 'waitlist_priority' then
    raise exception 'SELFTEST FAIL: an uninvolved public user should have been turned away during the waitlist window, got %', v_result;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cara, 'role', 'authenticated')::text, true);
  select public.join_event_atomic(v_ev1, v_cara) into v_result;
  if v_result <> 'joined' then
    raise exception 'SELFTEST FAIL: the notified waitlister should have been able to claim the spot, got %', v_result;
  end if;

  perform set_config('role', v_admin_role, true);

  -- ══════════ Scenario 2: window expired -> opens to public ══════════
  insert into events (creator_user_id, title, start_time, max_invites, status)
  values (v_dave, 'selftest waitlist priority: expired window', now() + interval '5 days', 1, 'forming')
  returning id into v_ev2;

  insert into event_members (event_id, user_id, role, status)
  values (v_ev2, v_dave, 'host', 'joined'), (v_ev2, v_alice, 'guest', 'joined');

  insert into event_waitlist (event_id, user_id) values (v_ev2, v_bob);

  update event_members set status = 'left' where event_id = v_ev2 and user_id = v_alice;

  if not exists (
    select 1 from app_notifications
    where event_id = v_ev2 and user_id = v_bob and type = 'waitlist_spot' and status = 'unread'
  ) then
    raise exception 'SELFTEST FAIL: the trigger chain did not notify Bob in scenario 2';
  end if;

  -- Simulate the notification's own timeout already having passed.
  update app_notifications
  set expires_at = now() - interval '1 minute'
  where event_id = v_ev2 and user_id = v_bob and type = 'waitlist_spot';

  perform set_config('request.jwt.claims', json_build_object('sub', v_cara, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.join_event_atomic(v_ev2, v_cara) into v_result;
  if v_result <> 'joined' then
    raise exception 'SELFTEST FAIL: once the waitlist window expired, the public should have been able to claim the spot, got %', v_result;
  end if;

  perform set_config('role', v_admin_role, true);

  -- ---------- cleanup ----------
  delete from app_notifications where event_id in (v_ev1, v_ev2) and type = 'waitlist_spot';
  delete from waitlist_notification_queue where event_id in (v_ev1, v_ev2);
  delete from event_waitlist where event_id in (v_ev1, v_ev2);
  delete from event_members where event_id in (v_ev1, v_ev2);
  delete from events where id in (v_ev1, v_ev2);

  raise notice 'SELFTEST PASS: waitlist_priority_enforcement';
end;
$selftest$;
