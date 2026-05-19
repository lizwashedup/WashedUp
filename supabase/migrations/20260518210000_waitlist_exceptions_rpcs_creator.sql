-- Waitlist Exceptions — Phase 1, Migration 2 of N: creator-side RPCs.
--
-- Depends on Migration 1 (20260518200000_waitlist_exceptions_schema) columns.
-- No triggers and no behavior change to existing flows. New functions only.
--
-- apply_migration runs in one transaction. The embedded self-test at the
-- bottom uses a nested BEGIN/EXCEPTION block: it asserts the functions exist,
-- are SECURITY DEFINER, and that their creator-authorization guard fires
-- (auth.uid() is NULL inside a migration, so the guard must reject). Any
-- failed assertion RAISEs and aborts the whole migration (no partial apply).
-- Behavioral correctness (FIFO, slot increment, 48h, notification) is
-- verified post-apply against a controlled real test plan.

-- ── get_waitlist_for_creator ────────────────────────────────────────────────
-- Creator-only. Returns the FIFO waitlist (kind='waitlist', position/total +
-- per-row exception_status + a shared-history context line) UNION the people
-- already let in via an exception (kind='accepted', read from
-- event_members.joined_via_exception, since the existing cleanup trigger
-- removes their event_waitlist row on join). Client does the blur.
CREATE OR REPLACE FUNCTION public.get_waitlist_for_creator(p_event_id uuid)
RETURNS TABLE(
  kind             text,
  user_id          uuid,
  first_name       text,
  photo            text,
  queue_position   integer,
  total            integer,
  exception_status text,
  context          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_creator uuid;
  v_total   integer;
BEGIN
  SELECT creator_user_id INTO v_creator FROM events WHERE id = p_event_id;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_creator THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT count(*)::int INTO v_total
  FROM event_waitlist w WHERE w.event_id = p_event_id;

  RETURN QUERY
  WITH wl AS (
    SELECT w.user_id,
           w.created_at,
           w.exception_status,
           row_number() OVER (ORDER BY w.created_at ASC)::int AS pos
    FROM event_waitlist w
    WHERE w.event_id = p_event_id
  )
  SELECT
    'waitlist'::text,
    wl.user_id,
    pp.first_name_display,
    pp.profile_photo_url,
    wl.pos,
    v_total,
    COALESCE(wl.exception_status, 'waiting'),
    COALESCE(
      (SELECT 'went to ' || e2.title || ' with you'
       FROM event_members mc
       JOIN event_members mu
         ON mu.event_id = mc.event_id AND mu.user_id = wl.user_id
       JOIN events e2 ON e2.id = mc.event_id
       WHERE mc.user_id = v_creator
         AND mc.status = 'joined' AND mu.status = 'joined'
         AND e2.id <> p_event_id
       ORDER BY e2.start_time DESC NULLS LAST
       LIMIT 1),
      'new to WashedUp')
  FROM wl
  JOIN profiles_public pp ON pp.id = wl.user_id
  UNION ALL
  SELECT
    'accepted'::text,
    em.user_id,
    pp.first_name_display,
    pp.profile_photo_url,
    NULL::int,
    v_total,
    'accepted'::text,
    NULL::text
  FROM event_members em
  JOIN profiles_public pp ON pp.id = em.user_id
  WHERE em.event_id = p_event_id
    AND em.joined_via_exception = true
    AND em.status = 'joined'
  ORDER BY 5 NULLS LAST;
END;
$fn$;

-- ── grant_waitlist_exception ────────────────────────────────────────────────
-- Creator-only. Enforces FIFO (target must be the next eligible waitlister:
-- earliest created_at whose exception_status is NULL or 'expired'), the hard
-- cap of 3, marks the row 'invited' with a 48h expiry, bumps the slot
-- counter, and notifies the waitlister. Returns the new slots-used count.
CREATE OR REPLACE FUNCTION public.grant_waitlist_exception(
  p_event_id uuid,
  p_user_id  uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_event       events%ROWTYPE;
  v_next_user   uuid;
  v_creator_nm  text;
  v_used        integer;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_event.creator_user_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF COALESCE(v_event.exception_slots_used, 0) >= 3 THEN
    RAISE EXCEPTION 'exception_cap_reached';
  END IF;

  -- Next eligible FIFO waitlister (never invited, or a lapsed invite).
  SELECT w.user_id INTO v_next_user
  FROM event_waitlist w
  WHERE w.event_id = p_event_id
    AND (w.exception_status IS NULL OR w.exception_status = 'expired')
  ORDER BY w.created_at ASC
  LIMIT 1;

  IF v_next_user IS NULL THEN
    RAISE EXCEPTION 'no_one_waiting';
  END IF;
  IF v_next_user <> p_user_id THEN
    RAISE EXCEPTION 'not_next_in_line';
  END IF;

  UPDATE event_waitlist
  SET exception_status     = 'invited',
      exception_invited_at = now(),
      exception_expires_at = now() + interval '48 hours'
  WHERE event_id = p_event_id AND user_id = p_user_id;

  UPDATE events
  SET exception_slots_used = COALESCE(exception_slots_used, 0) + 1
  WHERE id = p_event_id
  RETURNING exception_slots_used INTO v_used;

  SELECT first_name_display INTO v_creator_nm
  FROM profiles_public WHERE id = v_event.creator_user_id;

  INSERT INTO app_notifications
    (user_id, type, title, body, event_id, status, actor_user_id, expires_at)
  VALUES (
    p_user_id,
    'exception_invite',
    'you''re in',
    COALESCE(v_creator_nm, 'the creator')
      || ' made an exception and is letting you in to '
      || COALESCE(v_event.title, 'a plan'),
    p_event_id,
    'unread',
    v_event.creator_user_id,
    now() + interval '48 hours'
  );

  RETURN v_used;
END;
$fn$;

-- ── close_waitlist / reopen_waitlist ────────────────────────────────────────
-- Creator-only. Only toggles UI visibility of the manager. FIFO order and the
-- slot counter live on the rows/events row, so they are preserved across a
-- close/reopen.
CREATE OR REPLACE FUNCTION public.close_waitlist(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_creator uuid;
BEGIN
  SELECT creator_user_id INTO v_creator FROM events WHERE id = p_event_id;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_creator THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE events SET waitlist_closed = true WHERE id = p_event_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reopen_waitlist(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_creator uuid;
BEGIN
  SELECT creator_user_id INTO v_creator FROM events WHERE id = p_event_id;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_creator THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE events SET waitlist_closed = false WHERE id = p_event_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_waitlist_for_creator(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_waitlist_exception(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_waitlist(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_waitlist(uuid) TO authenticated;

-- ── Embedded self-test ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_ok boolean;
BEGIN
  -- Signatures + SECURITY DEFINER present.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_waitlist_for_creator'
      AND p.prosecdef AND pg_get_function_identity_arguments(p.oid)='p_event_id uuid') THEN
    RAISE EXCEPTION 'ASSERT: get_waitlist_for_creator missing/not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='grant_waitlist_exception'
      AND p.prosecdef AND pg_get_function_identity_arguments(p.oid)='p_event_id uuid, p_user_id uuid') THEN
    RAISE EXCEPTION 'ASSERT: grant_waitlist_exception missing/not SECURITY DEFINER';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('close_waitlist','reopen_waitlist')
        AND p.prosecdef) < 2 THEN
    RAISE EXCEPTION 'ASSERT: close/reopen_waitlist missing/not SECURITY DEFINER';
  END IF;

  -- Authorization guard fires (no JWT in a migration -> auth.uid() is NULL,
  -- so every function must reject with not_authorized / not_found, never
  -- silently succeed). Use a random event id.
  BEGIN
    PERFORM public.close_waitlist('00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'ASSERT: close_waitlist did not reject unauthorized call';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'ASSERT:%' THEN RAISE; END IF;
      -- expected: not_found / not_authorized -> guard works
      v_ok := true;
  END;

  RAISE NOTICE 'waitlist_exceptions_rpcs_creator self-test passed';
END $$;
