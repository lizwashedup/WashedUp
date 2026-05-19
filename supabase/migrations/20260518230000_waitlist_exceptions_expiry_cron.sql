-- Waitlist Exceptions — Phase 1, Migration 4 of N (final Phase 1):
-- process_expired_exceptions() + a dedicated pg_cron job.
--
-- Depends on Migrations 1–3. apply_migration runs in one transaction; the
-- self-test at the bottom asserts the function + cron job exist and runs the
-- function once as a live smoke test (safe: 0 'invited' rows on prod at author
-- time, and the function is a no-op set-based statement when nothing is due).
-- Any failed assertion RAISEs and rolls back the whole migration.
--
-- pg_cron uses UTC. Convention mirrored from 20260504220000_albums_v1_cron.sql:
-- SECURITY DEFINER + SET search_path, REVOKE ALL FROM PUBLIC (this is a
-- maintenance job, never a client RPC), cron.schedule() upserts by job name.

-- ── process_expired_exceptions() ────────────────────────────────────────────
-- One set-based statement. Flips every lapsed 'invited' waitlist row to
-- 'expired', refunds exactly one exception slot per expired invite to its
-- event (clamped at 0), and tells each affected creator a slot is free again
-- using the same 'exception_slot_refunded' type as the manual decline path
-- (so creator-facing copy/handling stays uniform). The expired waitlister is
-- NOT notified: they let a 48h invite lapse, and grant_waitlist_exception only
-- re-picks NULL/'expired' rows, so they remain eligible for a future invite.
-- Data-modifying CTEs each run exactly once to completion regardless of the
-- final SELECT (Postgres semantics); 'expired' is materialized and reused.
CREATE OR REPLACE FUNCTION public.process_expired_exceptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  WITH expired AS (
    UPDATE event_waitlist w
    SET exception_status     = 'expired',
        exception_expires_at = NULL
    WHERE w.exception_status = 'invited'
      AND w.exception_expires_at IS NOT NULL
      AND w.exception_expires_at <= now()
    RETURNING w.event_id, w.user_id
  ),
  per_event AS (
    SELECT event_id, count(*)::int AS n
    FROM expired
    GROUP BY event_id
  ),
  refunded AS (
    UPDATE events e
    SET exception_slots_used = GREATEST(0, COALESCE(e.exception_slots_used, 0) - pe.n)
    FROM per_event pe
    WHERE e.id = pe.event_id
    RETURNING e.id
  ),
  notified AS (
    INSERT INTO app_notifications
      (user_id, type, title, body, event_id, actor_user_id)
    SELECT ev.creator_user_id,
           'exception_slot_refunded',
           'a slot opened back up',
           'an exception invite to "'
             || COALESCE(ev.title, 'your plan')
             || '" expired without a response, so you have an exception slot back.',
           ex.event_id,
           ex.user_id
    FROM expired ex
    JOIN events ev ON ev.id = ex.event_id
    WHERE ev.creator_user_id IS NOT NULL
      AND ev.creator_user_id <> ex.user_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM expired;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_exceptions() FROM PUBLIC;

-- ── pg_cron schedule ────────────────────────────────────────────────────────
-- Every 15 minutes (UTC). A lapsed invite frees the creator's slot within at
-- most ~15m of the 48h mark — same cadence as the existing albums-mark-ready
-- job (*/15 * * * *). The function is a cheap no-op set-based statement when
-- nothing is due, so the higher run frequency on this low-volume table is
-- inexpensive. cron.schedule() upserts by name, so re-applying is idempotent.
SELECT cron.schedule(
  'waitlist-exceptions-expire',
  '*/15 * * * *',
  $cron$ SELECT public.process_expired_exceptions(); $cron$
);

-- ── Embedded self-test (aborts + rolls back the whole migration on failure) ──
DO $$
DECLARE
  v_fns  int;
  v_jobs int;
  v_ret  int;
BEGIN
  SELECT COUNT(*) INTO v_fns
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_expired_exceptions'
    AND p.prosecdef
    AND pg_get_function_identity_arguments(p.oid) = '';
  IF v_fns <> 1 THEN
    RAISE EXCEPTION 'ASSERT: process_expired_exceptions missing/not SECURITY DEFINER/wrong args';
  END IF;

  SELECT COUNT(*) INTO v_jobs
  FROM cron.job
  WHERE jobname = 'waitlist-exceptions-expire'
    AND schedule = '*/15 * * * *';
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'ASSERT: waitlist-exceptions-expire cron job missing/wrong schedule';
  END IF;

  -- Live smoke: nothing is 'invited' at author time, so this must return 0 and
  -- mutate nothing. Proves the SQL parses and executes end to end.
  SELECT public.process_expired_exceptions() INTO v_ret;
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'ASSERT: smoke run expected 0 expirations, got %', v_ret;
  END IF;

  RAISE NOTICE 'waitlist_exceptions_expiry_cron self-test passed';
END $$;
