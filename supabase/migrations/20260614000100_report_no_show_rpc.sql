-- LB-1: restore the post-plan survey's "Who made it?" write.
--
-- The survey's attendance step was dropping every "didn't make it" tap: nothing
-- in the app wrote no_show_reports, and the table has RLS enabled with ZERO
-- policies, so a direct client insert is denied. This adds a SECURITY DEFINER
-- RPC the survey calls per no-show. It validates that both the reporter and the
-- target were members of the event, blocks self-reports, and is idempotent so a
-- re-submit never double-counts.
--
-- No schema change to no_show_reports (event_id, reporter_user_id,
-- no_show_user_id, created_at already exist). Function only + grant.

CREATE OR REPLACE FUNCTION public.report_no_show(
  p_event_id uuid,
  p_no_show_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF v_me = p_no_show_user_id THEN
    RAISE EXCEPTION 'cannot_report_self';
  END IF;

  -- The reporter must have been on the plan.
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = v_me
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  -- You can only no-show someone who was also on the plan.
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = p_no_show_user_id
  ) THEN
    RAISE EXCEPTION 'target_not_a_member';
  END IF;

  -- Idempotent: one report per (event, reporter, target).
  INSERT INTO public.no_show_reports (event_id, reporter_user_id, no_show_user_id)
  SELECT p_event_id, v_me, p_no_show_user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.no_show_reports r
    WHERE r.event_id = p_event_id
      AND r.reporter_user_id = v_me
      AND r.no_show_user_id = p_no_show_user_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.report_no_show(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_no_show(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- In-transaction self-test (atomic rollback net; never strip on apply).
-- Runs against a real event with 2+ members, asserts a row is written and that
-- a repeat call is idempotent, then rolls back ONLY the test mutations via a
-- sentinel exception in a subtransaction so the function definition persists.
-- ---------------------------------------------------------------------------
DO $T$
DECLARE
  v_event    uuid;
  v_reporter uuid;
  v_noshow   uuid;
  v_count    int;
BEGIN
  BEGIN
    SELECT em.event_id INTO v_event
    FROM public.event_members em
    GROUP BY em.event_id
    HAVING count(DISTINCT em.user_id) >= 2
    LIMIT 1;

    IF v_event IS NULL THEN
      RAISE NOTICE 'report_no_show self-test SKIPPED: no event with 2+ members';
    ELSE
      SELECT em.user_id INTO v_reporter
      FROM public.event_members em WHERE em.event_id = v_event LIMIT 1;
      SELECT em.user_id INTO v_noshow
      FROM public.event_members em
      WHERE em.event_id = v_event AND em.user_id <> v_reporter LIMIT 1;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_reporter)::text, true);

      PERFORM public.report_no_show(v_event, v_noshow);
      SELECT count(*) INTO v_count FROM public.no_show_reports r
      WHERE r.event_id = v_event
        AND r.reporter_user_id = v_reporter
        AND r.no_show_user_id = v_noshow;
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'self-test FAILED: expected 1 row, got %', v_count;
      END IF;

      -- idempotency: a second call must not add a duplicate
      PERFORM public.report_no_show(v_event, v_noshow);
      SELECT count(*) INTO v_count FROM public.no_show_reports r
      WHERE r.event_id = v_event
        AND r.reporter_user_id = v_reporter
        AND r.no_show_user_id = v_noshow;
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'self-test FAILED idempotency: got % rows', v_count;
      END IF;

      RAISE NOTICE 'report_no_show self-test PASSED';
      RAISE EXCEPTION 'ROLLBACK_SELFTEST';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_SELFTEST' THEN RAISE; END IF;
    RAISE NOTICE 'report_no_show self-test rolled back cleanly';
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
END;
$T$;
