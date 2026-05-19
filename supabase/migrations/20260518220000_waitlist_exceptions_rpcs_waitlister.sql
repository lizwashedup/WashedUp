-- Waitlist Exceptions — Phase 1, Migration 3 of N: waitlister-side RPCs
-- + the notify_creator_waitlist_join() retype (member_joined -> waitlist_request).
--
-- Depends on Migration 1 (schema) and Migration 2 (creator RPCs / slot counter).
-- apply_migration runs in one transaction. The embedded self-test at the bottom
-- uses nested BEGIN/EXCEPTION blocks: it asserts the new functions exist, are
-- SECURITY DEFINER, that their authentication guard fires (auth.uid() is NULL
-- inside a migration, so accept/decline must reject), and that the retyped
-- trigger function now emits 'waitlist_request'. Any failed assertion RAISEs and
-- aborts the whole migration (no partial apply). Behavioral correctness (join
-- over cap, slot refund, FIFO interaction, push) is verified post-apply against
-- a controlled real test plan.
--
-- Verified against prod before authoring:
--   * event_members: role member_role{host,guest} NOT NULL (no default),
--     status member_status{joined,left,removed} DEFAULT 'joined',
--     joined_via_exception bool NOT NULL DEFAULT false,
--     UNIQUE(event_id,user_id). No capacity CHECK -> over-cap insert is allowed.
--   * cleanup_waitlist_on_join() deletes the event_waitlist row on join (bound
--     by two duplicate AFTER INSERT triggers + one AFTER UPDATE OF status), so
--     accept must NOT rely on updating event_waitlist after the member insert.
--   * notify_member_joined() AFTER INSERT already notifies the creator + members
--     on any join, so accept_waitlist_exception adds NO creator notification of
--     its own (would double-notify). DECLINE/refund is a new state the creator
--     is not otherwise told about, so that one does insert a notification.

-- ── accept_waitlist_exception ───────────────────────────────────────────────
-- Caller = the invited waitlister. Validates an active (not lapsed) 'invited'
-- exception on their own event_waitlist row, then joins them as a normal guest
-- but flagged joined_via_exception. The existing cleanup_waitlist_on_join
-- trigger removes their event_waitlist row; we also delete it explicitly so the
-- result does not depend on trigger ordering or the ON CONFLICT (no-INSERT)
-- path. The slot stays consumed (the cap counts realised exceptions).
CREATE OR REPLACE FUNCTION public.accept_waitlist_exception(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_wl  event_waitlist%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_wl
  FROM event_waitlist
  WHERE event_id = p_event_id AND user_id = v_uid
  FOR UPDATE;

  IF v_wl.user_id IS NULL THEN
    RAISE EXCEPTION 'not_on_waitlist';
  END IF;
  IF v_wl.exception_status IS DISTINCT FROM 'invited' THEN
    RAISE EXCEPTION 'no_active_invite';
  END IF;
  IF v_wl.exception_expires_at IS NOT NULL
     AND v_wl.exception_expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;

  -- Join over cap. Recover a prior 'left'/'removed' row if one exists.
  INSERT INTO event_members (event_id, user_id, role, status, joined_via_exception)
  VALUES (p_event_id, v_uid, 'guest', 'joined', true)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET status               = 'joined',
        joined_via_exception = true,
        joined_at            = now();

  -- Defensive: cleanup_waitlist_on_join removes this on the INSERT path; do it
  -- ourselves so the ON CONFLICT (UPDATE) path is also consistent. No-op if the
  -- trigger already deleted it.
  DELETE FROM event_waitlist
  WHERE event_id = p_event_id AND user_id = v_uid;

  -- No creator notification here: notify_member_joined() already fires on the
  -- event_members insert and tells the creator + members someone joined.
END;
$fn$;

-- ── decline_waitlist_exception ──────────────────────────────────────────────
-- Caller = the invited waitlister. Marks their row 'declined' (kept on the
-- waitlist; grant_waitlist_exception only re-picks NULL/'expired' rows, so a
-- decline is never auto-re-invited), refunds the creator's slot, and tells the
-- creator a slot is free again (a state notify_member_joined never covers).
CREATE OR REPLACE FUNCTION public.decline_waitlist_exception(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_wl         event_waitlist%ROWTYPE;
  v_event      events%ROWTYPE;
  v_decliner   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_wl
  FROM event_waitlist
  WHERE event_id = p_event_id AND user_id = v_uid
  FOR UPDATE;

  IF v_wl.user_id IS NULL THEN
    RAISE EXCEPTION 'not_on_waitlist';
  END IF;
  IF v_wl.exception_status IS DISTINCT FROM 'invited' THEN
    RAISE EXCEPTION 'no_active_invite';
  END IF;

  UPDATE event_waitlist
  SET exception_status     = 'declined',
      exception_expires_at = NULL
  WHERE event_id = p_event_id AND user_id = v_uid;

  -- Lock the event row before touching the shared slot counter (mirrors
  -- grant_waitlist_exception's FOR UPDATE) and refund one slot.
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF v_event.id IS NOT NULL THEN
    UPDATE events
    SET exception_slots_used = GREATEST(0, COALESCE(exception_slots_used, 0) - 1)
    WHERE id = p_event_id;

    SELECT first_name_display INTO v_decliner
    FROM profiles_public WHERE id = v_uid;

    IF v_event.creator_user_id IS NOT NULL
       AND v_event.creator_user_id <> v_uid THEN
      INSERT INTO app_notifications
        (user_id, type, title, body, event_id, actor_user_id)
      VALUES (
        v_event.creator_user_id,
        'exception_slot_refunded',
        'a slot opened back up',
        COALESCE(v_decliner, 'someone')
          || ' passed on the invite to '
          || COALESCE(v_event.title, 'your plan')
          || ', so you have an exception slot back.',
        p_event_id,
        v_uid
      );
    END IF;
  END IF;
END;
$fn$;

-- ── notify_creator_waitlist_join() retype ───────────────────────────────────
-- Existing trigger function (bound by trigger on_waitlist_join_notify_creator,
-- AFTER INSERT ON event_waitlist). Per decision: same trigger, same firing,
-- but emit the new dedicated 'waitlist_request' type (was 'member_joined',
-- which collided with real joins) and friendlier copy that names the requester.
-- CREATE OR REPLACE FUNCTION keeps the existing trigger binding intact; no
-- DROP/CREATE TRIGGER. No em/en-dashes in copy (standing rule).
CREATE OR REPLACE FUNCTION public.notify_creator_waitlist_join()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_event_title text;
  v_creator_id  uuid;
  v_requester   text;
BEGIN
  SELECT title, creator_user_id INTO v_event_title, v_creator_id
  FROM events WHERE id = NEW.event_id;

  IF v_creator_id IS NOT NULL AND v_creator_id <> NEW.user_id THEN
    SELECT first_name_display INTO v_requester
    FROM profiles_public WHERE id = NEW.user_id;

    INSERT INTO app_notifications
      (user_id, type, title, body, event_id, actor_user_id)
    VALUES (
      v_creator_id,
      'waitlist_request',
      'someone wants in',
      COALESCE(v_requester, 'someone')
        || ' asked to join "'
        || COALESCE(v_event_title, 'your plan')
        || '". you can make an exception and let them in.',
      NEW.event_id,
      NEW.user_id
    );
  END IF;

  RETURN NEW;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.accept_waitlist_exception(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_waitlist_exception(uuid) TO authenticated;

-- ── Embedded self-test (aborts + rolls back the whole migration on failure) ──
DO $$
DECLARE
  v_def text;
BEGIN
  -- Signatures + SECURITY DEFINER present.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='accept_waitlist_exception'
      AND p.prosecdef
      AND pg_get_function_identity_arguments(p.oid)='p_event_id uuid') THEN
    RAISE EXCEPTION 'ASSERT: accept_waitlist_exception missing/not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='decline_waitlist_exception'
      AND p.prosecdef
      AND pg_get_function_identity_arguments(p.oid)='p_event_id uuid') THEN
    RAISE EXCEPTION 'ASSERT: decline_waitlist_exception missing/not SECURITY DEFINER';
  END IF;

  -- The trigger function now emits the dedicated type, not member_joined.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='notify_creator_waitlist_join';
  IF v_def IS NULL OR strpos(v_def, '''waitlist_request''') = 0 THEN
    RAISE EXCEPTION 'ASSERT: notify_creator_waitlist_join not retyped to waitlist_request';
  END IF;
  IF strpos(v_def, '''member_joined''') <> 0 THEN
    RAISE EXCEPTION 'ASSERT: notify_creator_waitlist_join still references member_joined';
  END IF;

  -- The trigger binding is untouched (still bound to event_waitlist insert).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_proc  p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND c.relname='event_waitlist'
      AND p.proname='notify_creator_waitlist_join'
      AND t.tgname='on_waitlist_join_notify_creator') THEN
    RAISE EXCEPTION 'ASSERT: on_waitlist_join_notify_creator trigger binding lost';
  END IF;

  -- Authentication guard fires (no JWT in a migration -> auth.uid() is NULL,
  -- so accept/decline must reject, never silently succeed).
  BEGIN
    PERFORM public.accept_waitlist_exception(
      '00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'ASSERT: accept_waitlist_exception did not reject unauthenticated call';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'ASSERT:%' THEN RAISE; END IF;  -- expected: not_authenticated
  END;
  BEGIN
    PERFORM public.decline_waitlist_exception(
      '00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'ASSERT: decline_waitlist_exception did not reject unauthenticated call';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'ASSERT:%' THEN RAISE; END IF;  -- expected: not_authenticated
  END;

  RAISE NOTICE 'waitlist_exceptions_rpcs_waitlister self-test passed';
END $$;
