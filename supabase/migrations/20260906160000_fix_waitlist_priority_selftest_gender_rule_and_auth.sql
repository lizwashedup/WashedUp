-- Repairs 20260904030000_waitlist_priority_enforcement.sql's bundled self-test.
-- That file's own real fix (join_event_atomic) is unchanged and already correct --
-- this migration re-applies the identical function body (CREATE OR REPLACE is a
-- no-op if it's already live) and replaces only the self-test, which is what
-- actually needed correcting. Existing migration history is immutable in this
-- repo (see scripts/release/migration-policy.mjs), so the fix lands here as a
-- new file rather than editing 20260904030000 in place -- same precedent as
-- 20260905010000 correcting 20260817180000.
--
-- Found running the original self-test against real production for the first
-- time (2026-09-06; no prior session had a live Postgres to catch this on):
--   1. events.gender_rule is NOT NULL in production; the original self-test's
--      insert never set it.
--   2. Inserting into events with no auth context trips
--      trg_events_insert_check_marks -> check_creator_milestones's own
--      auth.uid() self-check. Real app usage never hits this (a creator
--      always inserts under their own session); the self-test's synthetic
--      no-context insert did.
-- Fix: set gender_rule = 'mixed' and set request.jwt.claims/role to the
-- acting user before each events insert, matching a real authenticated
-- request. Verified with a real ROLLBACK-wrapped dry run against production,
-- then applied for real -- see
-- docs/database/direct-apply-evidence-20260906-held-migrations-batch.md.

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

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;

  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF v_event.status = 'full' THEN
    RETURN 'full';
  END IF;

  SELECT count(*)::int INTO v_member_count
  FROM event_members
  WHERE event_id = p_event_id AND status = 'joined';

  IF v_member_count > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
    RETURN 'full';
  END IF;

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

  UPDATE event_members
  SET status = 'joined', role = 'guest',
      age_at_join = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  IF (v_member_count + 1) > COALESCE(v_event.max_invites, 7) THEN
    UPDATE events SET status = 'full' WHERE id = p_event_id;
  END IF;

  RETURN 'joined';
END;
$function$;

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

  perform set_config('request.jwt.claims', json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into events (creator_user_id, title, start_time, max_invites, status, gender_rule)
  values (v_alice, 'selftest waitlist priority: active window', now() + interval '5 days', 1, 'forming', 'mixed')
  returning id into v_ev1;
  perform set_config('role', v_admin_role, true);

  insert into event_members (event_id, user_id, role, status)
  values (v_ev1, v_alice, 'host', 'joined'), (v_ev1, v_bob, 'guest', 'joined');

  insert into event_waitlist (event_id, user_id) values (v_ev1, v_cara);

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

  perform set_config('request.jwt.claims', json_build_object('sub', v_dave, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into events (creator_user_id, title, start_time, max_invites, status, gender_rule)
  values (v_dave, 'selftest waitlist priority: expired window', now() + interval '5 days', 1, 'forming', 'mixed')
  returning id into v_ev2;
  perform set_config('role', v_admin_role, true);

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

  delete from app_notifications where event_id in (v_ev1, v_ev2) and type = 'waitlist_spot';
  delete from waitlist_notification_queue where event_id in (v_ev1, v_ev2);
  delete from event_waitlist where event_id in (v_ev1, v_ev2);
  delete from event_members where event_id in (v_ev1, v_ev2);
  delete from events where id in (v_ev1, v_ev2);

  raise notice 'SELFTEST PASS: waitlist_priority_enforcement (repaired self-test)';
end;
$selftest$;
