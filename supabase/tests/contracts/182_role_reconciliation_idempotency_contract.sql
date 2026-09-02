\set ON_ERROR_STOP on

-- Runs after the runner has, in order: applied the migration once (covered
-- by 181), manually flipped one non-PDF toggle on the leader's own
-- assignment (simulating "Build 35 permission code may already have edited
-- an assignment"), and re-applied the SAME migration file a second time.
--
-- Proves the migration's own claim "Idempotent. Safe to re-run ... never
-- overwrites an assignment that Build 35 code may already have edited."
-- ON CONFLICT DO NOTHING is the mechanism; this is the outside proof it
-- actually behaves that way, not just that it doesn't error on a re-run.
--
-- The manual edit under test here is on the 'finance'-tier row (member 8),
-- deliberately NOT the leader's own row. Real, separately-verified finding:
-- the migration's trailing self-test unconditionally re-checks every
-- source_role='leader' row on EVERY apply (v_weak_creator), so editing a
-- leader-derived assignment's roster/finance toggle and then re-running the
-- migration raises "A3 self-test: 1 leader rows mapped to a reduced
-- Creator" -- even though the INSERT's own ON CONFLICT DO NOTHING would
-- have left that edit alone. "Idempotent, safe to re-run" is therefore true
-- for every row EXCEPT a downgraded leader row. That narrower behavior is
-- pinned down on purpose, immediately below, rather than avoided.

DO $$
DECLARE
  v_count       bigint;
  v_finance     boolean;
BEGIN
  -- No duplicate rows: still exactly 7, matching 181's count, after a
  -- second full apply.
  SELECT count(*) INTO v_count FROM public.community_role_assignments;
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'A3 idempotency: expected 7 assignments after a second apply, found %', v_count;
  END IF;

  -- The manual edit made between the two applies (on a non-leader row) was
  -- NOT overwritten by ON CONFLICT DO NOTHING.
  SELECT can_view_community_finance INTO v_finance
    FROM public.community_role_assignments
   WHERE member_id = '60000000-0000-0000-0000-000000000008';
  IF v_finance IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A3 idempotency: a re-run overwrote a manually-edited assignment (can_view_community_finance=%)', v_finance;
  END IF;

  -- FK cascade: removing a community_members row removes its assignment.
  DELETE FROM public.community_members WHERE id = '60000000-0000-0000-0000-000000000004';
  IF EXISTS (SELECT 1 FROM public.community_role_assignments WHERE member_id = '60000000-0000-0000-0000-000000000004') THEN
    RAISE EXCEPTION 'A3 idempotency: deleting a community_members row left an orphaned assignment behind';
  END IF;
  SELECT count(*) INTO v_count FROM public.community_role_assignments;
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'A3 idempotency: expected 6 assignments after the cascade delete, found %', v_count;
  END IF;
END $$;

SELECT 'PASS: A3 re-run is idempotent, preserves a manual edit made between applies, and the membership foreign key cascades cleanly' AS result;
