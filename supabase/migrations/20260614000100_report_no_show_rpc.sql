-- LB-1: guarded write path for the post-plan survey's "Who made it?" step.
-- The rebuilt survey wrote nothing; the table also had a permissive INSERT policy
-- ("Users can submit reports") that let clients write directly and bypass any
-- validation. This adds a SECURITY DEFINER RPC (member-only, no self-report,
-- attendee-only, idempotent) AND drops the permissive policy so the RPC is the
-- ONLY write path. SELECT policy ("Users can view own reports") is kept.
-- Schema unchanged (event_id, reporter_user_id, no_show_user_id, created_at exist).
--
-- Prod-1.0.4 note: the legacy survey writes no_show_reports via a DIRECT insert
-- that is best-effort/caught (components/PostPlanSurvey.tsx: `const { error } =
-- await ...insert(rows); if (error) console.warn(...)`), so dropping the policy
-- only makes that insert log a warning on 1.0.4 until everyone is on 1.0.5. No
-- consumer reads no_show_reports, so the gap is harmless.

CREATE OR REPLACE FUNCTION public.report_no_show(p_event_id uuid, p_no_show_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF v_me = p_no_show_user_id THEN RAISE EXCEPTION 'cannot_report_self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_members em
                 WHERE em.event_id=p_event_id AND em.user_id=v_me) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_members em
                 WHERE em.event_id=p_event_id AND em.user_id=p_no_show_user_id) THEN
    RAISE EXCEPTION 'target_not_a_member';
  END IF;
  INSERT INTO public.no_show_reports (event_id, reporter_user_id, no_show_user_id)
  SELECT p_event_id, v_me, p_no_show_user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.no_show_reports r
    WHERE r.event_id=p_event_id AND r.reporter_user_id=v_me
      AND r.no_show_user_id=p_no_show_user_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.report_no_show(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_no_show(uuid, uuid) TO authenticated;

-- Close the bypass: the guarded RPC becomes the only INSERT path. Keep SELECT.
DROP POLICY IF EXISTS "Users can submit reports" ON public.no_show_reports;

-- In-transaction self-test (atomic rollback net; never strip on apply). Proves
-- BOTH the lockdown and the RPC, then rolls back ONLY the test mutations via a
-- sentinel exception so the function + policy drop persist.
DO $T$
DECLARE
  v_event uuid; v_reporter uuid; v_noshow uuid;
  a_denied boolean := false; b_rows int := -1;
BEGIN
  BEGIN
    SELECT em.event_id INTO v_event FROM public.event_members em
      GROUP BY em.event_id HAVING count(DISTINCT em.user_id) >= 2 LIMIT 1;
    IF v_event IS NULL THEN
      RAISE NOTICE 'self-test SKIPPED: no event with 2+ members';
      RAISE EXCEPTION 'ROLLBACK_SELFTEST';
    END IF;
    SELECT em.user_id INTO v_reporter FROM public.event_members em
      WHERE em.event_id=v_event LIMIT 1;
    SELECT em.user_id INTO v_noshow FROM public.event_members em
      WHERE em.event_id=v_event AND em.user_id<>v_reporter LIMIT 1;

    -- (a) a direct authenticated INSERT must now be DENIED by RLS
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_reporter)::text, true);
    BEGIN
      INSERT INTO public.no_show_reports(event_id, reporter_user_id, no_show_user_id)
      VALUES (v_event, v_reporter, v_noshow);
    EXCEPTION WHEN insufficient_privilege THEN a_denied := true;
    END;
    RESET ROLE;
    IF NOT a_denied THEN
      RAISE EXCEPTION 'SELF-TEST FAIL (a): direct authenticated INSERT was ALLOWED';
    END IF;
    RAISE NOTICE 'PASS (a): direct authenticated INSERT denied by RLS';

    -- (b) the RPC still works for an authenticated caller and is idempotent
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_reporter)::text, true);
    PERFORM public.report_no_show(v_event, v_noshow);
    PERFORM public.report_no_show(v_event, v_noshow);
    RESET ROLE;
    SELECT count(*) INTO b_rows FROM public.no_show_reports r
      WHERE r.event_id=v_event AND r.reporter_user_id=v_reporter
        AND r.no_show_user_id=v_noshow;
    IF b_rows <> 1 THEN
      RAISE EXCEPTION 'SELF-TEST FAIL (b): expected 1 row, got %', b_rows;
    END IF;
    RAISE NOTICE 'PASS (b): report_no_show wrote 1 row and is idempotent';

    RAISE EXCEPTION 'ROLLBACK_SELFTEST';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', NULL, true);
    RESET ROLE;
    IF SQLERRM <> 'ROLLBACK_SELFTEST' THEN RAISE; END IF;  -- real failure aborts the migration
    RAISE NOTICE 'self-test rolled back cleanly';
  END;
END;
$T$;
