-- The hourly "auto-complete-past-plans" cron job (jobid 7, schedule '0 * * * *')
-- has been failing on every single run since some point after the 8/13
-- security pass. Confirmed live via cron.job_run_details: every recent run
-- returns "ERROR: unauthorized" from check_creator_milestones(uuid), raised
-- inside trg_events_update_check_marks(), the trigger this migration fixes.
--
-- Root cause: check_creator_milestones(p_user_id) has a self-check,
-- `IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION
-- 'unauthorized'`, meant to stop a user from awarding themselves marks under
-- someone else's id. That check is correct for any direct/RPC-reachable
-- call. But trg_events_update_check_marks() also calls it from an UPDATE
-- trigger on public.events, and the cron job's UPDATE runs with no
-- authenticated session at all -- auth.uid() is NULL every time -- so the
-- trigger's PERFORM call has been unconditionally throwing, aborting the
-- cron's entire UPDATE in the same transaction. A trigger failure rolls back
-- the triggering statement, so not one plan has been auto-marked 'completed'
-- by this job since it started failing -- confirmed live: 5 real events are
-- currently stuck past their end_time in 'forming' status.
--
-- This is why, independently, real users have been unable to get a post-plan
-- survey (get_pending_post_plan_survey requires events.status='completed'),
-- unable to find people from a plan they attended (get_plan_history_backlog,
-- same requirement), and seeing undercounted shared-plan totals
-- (yours_shared_completed_count, same requirement) -- all three read the
-- same events.status column this trigger's failure has been preventing from
-- ever reaching 'completed'.
--
-- Fix: skip the milestone check entirely when there is no authenticated
-- caller (a system/background UPDATE), instead of weakening
-- check_creator_milestones's own self-check, which stays exactly as
-- protective as it was for every real, user-initiated path. A plan that
-- transitions status because of a real user's own action still has a real
-- auth.uid() and is unaffected; only the cron's own bulk sweep is exempted.
-- Milestones are not time-critical -- skipping the check on a system-driven
-- transition costs nothing, the same user's next authenticated action that
-- touches events will naturally re-evaluate it.
--
-- Once this applies, the cron job's own UPDATE (already correctly scoped:
-- status IN ('forming','active','full') AND start_time + interval '6 hours'
-- < now()) will succeed on its next scheduled run and sweep all currently
-- stuck events on its own -- no separate manual backfill UPDATE is included
-- here, deliberately, to avoid a second live data write beyond this fix.
--
-- KNOWN REMAINING GAP, found + empirically reproduced 2026-08-21, NOT fixed
-- by this migration: line 31-33 above ("a real user's own action ... is
-- unaffected") is only true when the acting user IS the event's creator.
-- join_event_atomic (20260812120000) lets a GUEST fill an event's last open
-- spot under their own real, legitimate session -- auth.uid() = the guest,
-- NOT the creator. Post-fix, that still calls check_creator_milestones with
-- a real, non-null auth.uid() that doesn't match creator_user_id, which
-- still throws 'unauthorized' inside check_creator_milestones itself
-- (20260813025124's own self-check), still with no exception handler in
-- join_event_atomic to catch it -- so the guest's entire join, not just the
-- status flip, still fails today. This is a PRE-EXISTING bug (the old
-- unconditional trigger body failed the exact same way for this exact
-- case), not a new regression from this migration, and this migration's own
-- self-test never exercises it since it only simulates the no-session cron
-- case. The real fix belongs in check_creator_milestones or the trigger's
-- call path (skip its self-check for any trigger-driven system call, not
-- just the null-session one) -- that touches a different, separately-live
-- function and is a real architecture call, deliberately not made here
-- without Josh's own sign-off first.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_events_update_check_marks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND auth.uid() IS NOT NULL THEN
    PERFORM check_creator_milestones(NEW.creator_user_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Self-test: confirm the exact failure mode is gone by simulating the cron's
-- own call shape -- an UPDATE with no auth.uid() session -- against a real
-- row, then reverting it so this migration makes no data decision of its own.
DO $$
DECLARE
  v_event_id uuid;
  v_old_status public.event_status;
BEGIN
  SELECT id, status INTO v_event_id, v_old_status
  FROM public.events
  WHERE status IN ('forming', 'active', 'full')
  ORDER BY id
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE NOTICE 'no forming/active/full event available to self-test against; skipping live probe (function body above still applied)';
    RETURN;
  END IF;

  BEGIN
    -- No request.jwt.claims set on purpose -- this intentionally runs with
    -- no auth context, matching exactly what the cron job's own session
    -- looks like.
    UPDATE public.events SET status = 'completed' WHERE id = v_event_id;
    RAISE NOTICE 'self-test passed: a system-context status UPDATE no longer raises unauthorized';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'self-test failed: system-context UPDATE still raises: %', SQLERRM;
  END;

  -- Roll back the test row's status -- this migration fixes the mechanism,
  -- it does not decide which events are actually complete.
  UPDATE public.events SET status = v_old_status WHERE id = v_event_id;
END $$;

COMMIT;
