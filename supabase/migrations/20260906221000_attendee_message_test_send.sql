-- REVIEW ONLY. Forward migration. Do not apply without explicit approval.
--
-- Send-test-to-yourself: two new, deliberately narrow RPCs so a creator can
-- preview real message/broadcast content by pushing it to themselves, with
-- zero dependency on either real send path.
--
-- HARD RULE this migration exists to satisfy: the test-send path must be
-- impossible to redirect to any other recipient. Neither function below
-- takes an audience/recipient parameter of any kind, not even an ignored
-- one -- the only possible target is auth.uid(), re-derived server-side on
-- every call, never a client-supplied id.
--
-- Both functions dispatch through the existing, already-live OneSignal
-- pipeline (app_notifications -> claim_pending_push_notifications ->
-- send-push-notifications), same as fanout_attendee_message_push and
-- fanout_follower_broadcast_push. claim_pending_push_notifications
-- (20260906150000_push_notification_retry_age_cutoff.sql) only suppresses
-- push for type='new_message' while the recipient has that chat open --
-- nothing suppresses a user receiving their own push, so a
-- user_id = actor_user_id row here pushes normally, exactly like the two
-- real fanout functions already rely on for the "leader gets their own
-- broadcast" non-issue.
--
-- 1. send_attendee_message_test_to_self(p_event_id, p_subject, p_body)
--
--    Re-checks the caller against public.is_ticketing_organizer(uuid, uuid),
--    the same live boundary every other ticketing/attendee screen already
--    trusts (payouts.tsx, check-in.tsx, event-money.tsx, ticketAttendees.ts,
--    web's organizerData.ts/ticketing.ts). Confirmed live and in real use via
--    docs/database/live-function-correctness-audit-20260824.md ("checks
--    direct creator or community leader"; intentionally granted to anon/
--    authenticated/service_role because captured RLS policies call it) plus
--    every RLS policy in this repo that calls is_community_leader with the
--    same (object_id, user_id) argument order this migration assumes.
--
--    Deliberately does NOT reuse washedup-web's draft
--    attendee_message_is_event_organizer() (20260904060000_attendee_message
--    _send.sql) -- that helper is its own header's admitted narrower,
--    unreviewed stand-in (host_user_id / community.created_by only, no
--    is_community_leader), and that whole migration is still unapplied
--    ("DO NOT APPLY WITHOUT JOSH'S WORD"). This RPC must work whether or not
--    that migration, or ATTENDEE_MESSAGE_SEND_ENABLED, ever ships -- so it
--    has zero dependency on either: it writes exactly one app_notifications
--    row and touches attendee_message_sends / attendee_message_opt_outs not
--    at all.
--
-- 2. send_follower_broadcast_test_to_self(p_target_kind, p_community_id, p_body)
--
--    'organizer' target: the caller is always the target, no extra check
--    needed (mirrors follower_broadcasts_insert's own organizer branch).
--    'community' target: re-checks is_community_leader(p_community_id,
--    auth.uid()) -- the exact predicate follower_broadcasts_insert's own RLS
--    policy already uses (20260818180000_follower_broadcasts_o03.sql).
--
--    NEVER writes to follower_broadcasts. That table's own SELECT RLS lets
--    any real follower read a row once visible_at passes -- a test row
--    landed there would leak real content to real followers a day (or a
--    minute) before anyone was supposed to see it, the same class of bug
--    20260820020000's own header already found and fixed once for scheduled
--    broadcasts. Skipping the table entirely is what keeps this a true
--    no-audience test. Writes exactly one app_notifications row instead,
--    same shape and same title-resolution rule fanout_follower_broadcast_push
--    already uses, targeting only the caller.
--
-- Both are SECURITY DEFINER, re-verify the caller independently of RLS on
-- every call, and are never referenced by any feature flag in application
-- code -- they work identically whether ATTENDEE_MESSAGE_SEND_ENABLED (or
-- any other send gate) is on or off.
--
-- ADDENDA (post-review):
--
--   Both functions cap the body at 2000 characters (matching
--   follower_broadcasts' own live CHECK, and now applied consistently to
--   both self-test RPCs) and are rate-limited to 3 test-sends per UTC day --
--   send_attendee_message_test_to_self per event, send_follower_broadcast_
--   test_to_self per caller+kind -- reusing enforce_attendee_message_daily_
--   cap()'s count-and-raise shape (20260904060000_attendee_message_send.sql)
--   directly against app_notifications, since neither function has, or
--   depends on, a sends table of its own. The count is scoped to rows where
--   user_id = actor_user_id, which only ever happens for a self-test: both
--   real fanout functions (fanout_attendee_message_push,
--   fanout_follower_broadcast_push) explicitly exclude the sender from their
--   own recipient query, so a real send can never inflate it.
--
--   The self-test below reads a real, already-existing event for
--   send_attendee_message_test_to_self rather than inserting one --
--   explore_events carries other live triggers (status milestone, community
--   topic creation) a synthetic row would fire against live data, the same
--   reason 20260901010000_build35_event_ownership.sql's own self-test never
--   exercises its insert/update trigger paths against a throwaway row
--   either. It skips those assertions, without failing, when no real event
--   exists yet to test against.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_ticketing_organizer(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'send_attendee_message_test_to_self dependency missing: public.is_ticketing_organizer(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.is_community_leader(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'send_follower_broadcast_test_to_self dependency missing: public.is_community_leader(uuid,uuid)';
  END IF;
  IF to_regclass('public.app_notifications') IS NULL
     OR to_regclass('public.explore_events') IS NULL
     OR to_regclass('public.communities') IS NULL THEN
    RAISE EXCEPTION 'attendee message test-send dependency missing: app_notifications/explore_events/communities';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. send_attendee_message_test_to_self
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_attendee_message_test_to_self(
  p_event_id uuid,
  p_subject text,
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_subject text;
  v_body text;
  v_id uuid;
  v_sent_today integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- defense in depth: re-derive authorization from the caller's own uid,
  -- never from a client-supplied flag. NULL is treated as "not authorized",
  -- not "unknown", since is_ticketing_organizer is expected to always return
  -- a real boolean (EXISTS-style), same posture as the money-adjacent checks
  -- elsewhere in this codebase.
  IF NOT COALESCE(public.is_ticketing_organizer(p_event_id, v_uid), false) THEN
    RAISE EXCEPTION 'not this event''s organizer';
  END IF;

  v_subject := btrim(coalesce(p_subject, ''));
  v_body := btrim(coalesce(p_body, ''));
  IF v_subject = '' THEN
    RAISE EXCEPTION 'subject is empty';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'message is empty';
  END IF;
  -- same 2000-char cap send_follower_broadcast_test_to_self already enforces
  -- below (itself mirroring follower_broadcasts' own live CHECK constraint) --
  -- this RPC had no length cap at all before, kept consistent with its
  -- sibling in this same file rather than left uncapped.
  IF char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'message is too long';
  END IF;

  -- rate limit: same reused pattern as enforce_attendee_message_daily_cap()
  -- (20260904060000_attendee_message_send.sql) -- 3 per event per day,
  -- counted over the current UTC calendar day. That trigger guards the real
  -- send's own attendee_message_sends table; this RPC deliberately has zero
  -- dependency on that table (see header), so the same count-and-cap shape
  -- is reused here directly against app_notifications instead. Self-test
  -- rows are the only app_notifications rows where user_id = actor_user_id
  -- for this type: fanout_attendee_message_push's own recipient query
  -- excludes the sender (`WHERE uid <> v_uid`), so a real send can never
  -- inflate this count.
  SELECT count(*) INTO v_sent_today
  FROM public.app_notifications
  WHERE event_id = p_event_id
    AND user_id = v_uid
    AND actor_user_id = v_uid
    AND type = 'broadcast'
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
  IF v_sent_today >= 3 THEN
    RAISE EXCEPTION 'test-send daily limit reached: % test sends already sent for this event today', v_sent_today;
  END IF;

  -- exactly one app_notifications row, targeting only the caller. Reuses the
  -- already-valid 'broadcast' type (same value fanout_attendee_message_push
  -- would use for a real send) so this previews as a real recipient would
  -- actually see it -- no attendee_message_sends row, no opt-out check, no
  -- ticket_orders/explore_event_rsvps read.
  INSERT INTO public.app_notifications
    (user_id, type, title, body, event_id, actor_user_id, status, push_sent, push_suppressed)
  VALUES
    (v_uid, 'broadcast', v_subject, v_body, p_event_id, v_uid, 'unread', false, false)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_attendee_message_test_to_self(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_attendee_message_test_to_self(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. send_follower_broadcast_test_to_self
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_follower_broadcast_test_to_self(
  p_target_kind text,
  p_community_id uuid,
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text;
  v_title text;
  v_type text;
  v_id uuid;
  v_sent_today integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_kind NOT IN ('organizer', 'community') THEN
    RAISE EXCEPTION 'invalid target kind';
  END IF;

  v_body := btrim(coalesce(p_body, ''));
  IF v_body = '' THEN
    RAISE EXCEPTION 'message is empty';
  END IF;
  -- same 2000-char cap follower_broadcasts itself enforces via CHECK -- this
  -- function never writes to that table, so the constraint isn't there to
  -- catch it for free; replicated here instead of skipped.
  IF char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'message is too long';
  END IF;

  IF p_target_kind = 'organizer' THEN
    -- the caller is always the target; no extra authorization needed,
    -- mirrors follower_broadcasts_insert's own organizer branch
    -- (organizer_user_id = auth.uid()).
    v_type := 'broadcast';
    SELECT coalesce(first_name_display, 'your organizer') INTO v_title
    FROM public.profiles_public WHERE id = v_uid;
  ELSE
    IF p_community_id IS NULL THEN
      RAISE EXCEPTION 'community id required';
    END IF;
    -- same predicate follower_broadcasts_insert's RLS policy already uses
    -- (20260818180000_follower_broadcasts_o03.sql). NULL treated as "not
    -- authorized", not "unknown" -- same posture as check #1 above.
    IF NOT COALESCE(public.is_community_leader(p_community_id, v_uid), false) THEN
      RAISE EXCEPTION 'not a leader of this community';
    END IF;
    v_type := 'community_broadcast';
    SELECT coalesce(name, 'your community') INTO v_title
    FROM public.communities WHERE id = p_community_id;
  END IF;

  -- rate limit: same reused pattern as send_attendee_message_test_to_self /
  -- enforce_attendee_message_daily_cap() -- 3 per day, counted over the
  -- current UTC calendar day. follower_broadcasts' own real send has no
  -- equivalent cap today, but an unlimited self-test push is still a real
  -- spam vector to the caller's own device, so the same shape applies here
  -- too. Scoped by (caller, kind) rather than by community id -- app_
  -- notifications carries no community_id column to scope more narrowly by,
  -- so a leader running several communities shares one combined daily quota
  -- across all of them, deliberately the more conservative reading. Self-
  -- test rows are the only app_notifications rows where user_id =
  -- actor_user_id for these types: fanout_follower_broadcast_push's own
  -- recipient query excludes the sender (`follower_user_id <> v_uid`), so a
  -- real send can never inflate this count.
  SELECT count(*) INTO v_sent_today
  FROM public.app_notifications
  WHERE user_id = v_uid
    AND actor_user_id = v_uid
    AND type = v_type
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
  IF v_sent_today >= 3 THEN
    RAISE EXCEPTION 'test-send daily limit reached: % test sends already sent today', v_sent_today;
  END IF;

  -- NEVER an insert into follower_broadcasts -- see header. Exactly one
  -- app_notifications row, targeting only the caller, same title-derivation
  -- rule and type value fanout_follower_broadcast_push already uses so this
  -- previews as a real follower would actually see it.
  INSERT INTO public.app_notifications
    (user_id, type, title, body, actor_user_id, status, push_sent, push_suppressed)
  VALUES
    (v_uid, v_type, coalesce(v_title, 'you'), v_body, v_uid, 'unread', false, false)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_follower_broadcast_test_to_self(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.send_follower_broadcast_test_to_self(text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. in-transaction self-test (never strip on apply)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_organizer uuid;
  v_leader uuid;
  v_stranger uuid;
  v_real_event_id uuid;
  v_real_event_owner uuid;
  v_event_stranger uuid;
  v_cid uuid;
  v_notif_id uuid;
  v_notif_id2 uuid;
  v_notif_id3 uuid;
  v_raised boolean;
  v_notif_count integer;
BEGIN
  SELECT id INTO v_organizer FROM auth.users ORDER BY created_at LIMIT 1 OFFSET 0;
  SELECT id INTO v_leader FROM auth.users WHERE id <> v_organizer ORDER BY created_at LIMIT 1 OFFSET 0;
  SELECT id INTO v_stranger FROM auth.users WHERE id NOT IN (v_organizer, v_leader) ORDER BY created_at LIMIT 1 OFFSET 0;
  IF v_organizer IS NULL OR v_leader IS NULL OR v_stranger IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs three existing users';
  END IF;

  -- ============ send_attendee_message_test_to_self ============

  -- Deliberately does NOT fabricate an explore_events row for this test --
  -- see this file's header remediation note and
  -- 20260901010000_build35_event_ownership.sql's own comment that
  -- explore_events carries other live triggers (status milestone, community
  -- topic creation) a synthetic insert would fire against live data. Uses a
  -- real, already-existing event instead, deriving its real owner from the
  -- row itself rather than assuming who owns it. Skips, never fails, the
  -- assertions below when this database has no real event yet -- the same
  -- "skip, don't fail" convention this repo already uses elsewhere (e.g. the
  -- gender-restricted-communities self-test) for exactly this situation.
  -- Production always has real events to test against (20260901010000's own
  -- backfill confirms several carry a real host_user_id); this branch only
  -- ever engages against an empty scratch database.
  SELECT id, host_user_id INTO v_real_event_id, v_real_event_owner
  FROM public.explore_events
  WHERE host_user_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_real_event_id IS NULL THEN
    RAISE NOTICE 'attendee_message_test_send self-test: no real event with an owner exists yet, skipping send_attendee_message_test_to_self assertions';
  ELSE
    SELECT id INTO v_event_stranger FROM auth.users WHERE id <> v_real_event_owner ORDER BY created_at LIMIT 1;
    IF v_event_stranger IS NULL THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: needs a second existing user distinct from the real event''s owner';
    END IF;

    -- a stranger cannot test-send for someone else's event
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_event_stranger, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      PERFORM public.send_attendee_message_test_to_self(v_real_event_id, 'hi', 'hi');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    RESET ROLE;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: a non-organizer could test-send for someone else''s event';
    END IF;

    -- a whitespace-only body is rejected
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_event_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      PERFORM public.send_attendee_message_test_to_self(v_real_event_id, 'hi', '   ');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    RESET ROLE;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: a whitespace-only body was accepted';
    END IF;

    -- an over-long body is rejected (2000-char cap)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_event_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      PERFORM public.send_attendee_message_test_to_self(v_real_event_id, 'hi', repeat('x', 2001));
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    RESET ROLE;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: a 2001-character body was accepted';
    END IF;

    -- the real organizer test-sends to themselves: exactly 1 correct
    -- app_notifications row, targeting only the caller
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_event_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT public.send_attendee_message_test_to_self(v_real_event_id, 'test subject', 'test body') INTO v_notif_id;
    RESET ROLE;
    IF v_notif_id IS NULL THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: organizer test-send did not return a notification id';
    END IF;

    SELECT count(*) INTO v_notif_count FROM public.app_notifications
    WHERE id = v_notif_id AND user_id = v_real_event_owner AND actor_user_id = v_real_event_owner
      AND event_id = v_real_event_id AND type = 'broadcast'
      AND title = 'test subject' AND body = 'test body';
    IF v_notif_count <> 1 THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: organizer test-send did not land exactly 1 correct app_notifications row';
    END IF;

    -- the daily cap allows 2 more test-sends today for this event (3
    -- total), then blocks a 4th
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_event_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT public.send_attendee_message_test_to_self(v_real_event_id, 'test subject 2', 'test body 2') INTO v_notif_id2;
    RESET ROLE;
    IF v_notif_id2 IS NULL THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: a 2nd test-send today was blocked before the daily cap';
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_event_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT public.send_attendee_message_test_to_self(v_real_event_id, 'test subject 3', 'test body 3') INTO v_notif_id3;
    RESET ROLE;
    IF v_notif_id3 IS NULL THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: a 3rd test-send today was blocked before the daily cap';
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_real_event_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      PERFORM public.send_attendee_message_test_to_self(v_real_event_id, 'test subject 4', 'test body 4');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    RESET ROLE;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'SELF-TEST FAIL: a 4th test-send today was not blocked by the daily cap';
    END IF;

    -- attendee_message_sends (if it exists at all -- its own migration is
    -- still unapplied as of this writing) must stay completely untouched
    IF to_regclass('public.attendee_message_sends') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.attendee_message_sends WHERE event_id = v_real_event_id) THEN
        RAISE EXCEPTION 'SELF-TEST FAIL: test-send wrote a row to attendee_message_sends';
      END IF;
    END IF;

    -- cleanup: the 3 notification rows this test created. Never touches
    -- explore_events -- a real pre-existing row was read, never inserted.
    DELETE FROM public.app_notifications WHERE id IN (v_notif_id, v_notif_id2, v_notif_id3);
  END IF;

  -- ============ send_follower_broadcast_test_to_self ============

  -- organizer-kind: caller is always the target, no leader check needed
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.send_follower_broadcast_test_to_self('organizer', NULL, 'organizer test body') INTO v_notif_id;
  RESET ROLE;
  IF v_notif_id IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: organizer-kind test-send did not return a notification id';
  END IF;
  SELECT count(*) INTO v_notif_count FROM public.app_notifications
  WHERE id = v_notif_id AND user_id = v_organizer AND actor_user_id = v_organizer
    AND type = 'broadcast' AND body = 'organizer test body';
  IF v_notif_count <> 1 THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: organizer-kind test-send did not land exactly 1 correct app_notifications row';
  END IF;

  -- the daily cap allows 2 more organizer-kind test-sends today (3 total),
  -- then blocks a 4th
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.send_follower_broadcast_test_to_self('organizer', NULL, 'organizer test body 2') INTO v_notif_id2;
  RESET ROLE;
  IF v_notif_id2 IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 2nd organizer-kind test-send today was blocked before the daily cap';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.send_follower_broadcast_test_to_self('organizer', NULL, 'organizer test body 3') INTO v_notif_id3;
  RESET ROLE;
  IF v_notif_id3 IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 3rd organizer-kind test-send today was blocked before the daily cap';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    PERFORM public.send_follower_broadcast_test_to_self('organizer', NULL, 'organizer test body 4');
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 4th organizer-kind test-send today was not blocked by the daily cap';
  END IF;

  DELETE FROM public.app_notifications WHERE id IN (v_notif_id, v_notif_id2, v_notif_id3);

  -- an invalid target kind is rejected
  v_raised := false;
  BEGIN
    PERFORM public.send_follower_broadcast_test_to_self('nonsense', NULL, 'x');
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: an invalid target kind was accepted';
  END IF;

  -- an over-long body is rejected
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    PERFORM public.send_follower_broadcast_test_to_self('organizer', NULL, repeat('x', 2001));
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 2001-character body was accepted';
  END IF;

  -- community-kind: a real leader
  INSERT INTO public.communities (handle, name, created_by, status)
  VALUES ('selftest-testsend-tmp', 'test-send selftest', v_leader, 'active')
  RETURNING id INTO v_cid;
  INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_cid, v_leader, 'leader', 'active', now());

  -- a non-leader cannot test-send for the community
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    PERFORM public.send_follower_broadcast_test_to_self('community', v_cid, 'not a leader');
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a non-leader could test-send a community broadcast';
  END IF;

  -- the real leader test-sends to themselves
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.send_follower_broadcast_test_to_self('community', v_cid, 'community test body') INTO v_notif_id;
  RESET ROLE;
  IF v_notif_id IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: community-kind test-send did not return a notification id';
  END IF;
  SELECT count(*) INTO v_notif_count FROM public.app_notifications
  WHERE id = v_notif_id AND user_id = v_leader AND actor_user_id = v_leader
    AND type = 'community_broadcast' AND body = 'community test body';
  IF v_notif_count <> 1 THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: community-kind test-send did not land exactly 1 correct app_notifications row';
  END IF;

  -- the daily cap allows 2 more community-kind test-sends today (3 total),
  -- then blocks a 4th
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.send_follower_broadcast_test_to_self('community', v_cid, 'community test body 2') INTO v_notif_id2;
  RESET ROLE;
  IF v_notif_id2 IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 2nd community-kind test-send today was blocked before the daily cap';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.send_follower_broadcast_test_to_self('community', v_cid, 'community test body 3') INTO v_notif_id3;
  RESET ROLE;
  IF v_notif_id3 IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 3rd community-kind test-send today was blocked before the daily cap';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    PERFORM public.send_follower_broadcast_test_to_self('community', v_cid, 'community test body 4');
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 4th community-kind test-send today was not blocked by the daily cap';
  END IF;

  -- follower_broadcasts must stay completely untouched by this function --
  -- checked by test body prefix, not by sender id, since v_organizer/
  -- v_leader are real pre-existing users who may already have real
  -- historical broadcast rows unrelated to this test.
  IF EXISTS (
    SELECT 1 FROM public.follower_broadcasts
    WHERE body LIKE 'organizer test body%' OR body LIKE 'community test body%'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: test-send wrote a row to follower_broadcasts';
  END IF;

  -- cleanup: leave zero trace
  DELETE FROM public.app_notifications WHERE id IN (v_notif_id, v_notif_id2, v_notif_id3);
  DELETE FROM public.community_members WHERE community_id = v_cid;
  DELETE FROM public.communities WHERE id = v_cid;

  RAISE NOTICE 'attendee_message_test_send / follower_broadcast_test_send self-test passed';
END;
$$;

COMMIT;
