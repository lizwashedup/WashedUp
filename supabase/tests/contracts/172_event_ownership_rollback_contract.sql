\set ON_ERROR_STOP on

-- Runs after the runner has extracted the REVERSAL comment block verbatim
-- from supabase/migrations/20260901010000_build35_event_ownership.sql's own
-- header (not a hand-copied duplicate that could drift) and executed it for
-- real against this same contract database, straight after
-- 171_event_ownership_contract.sql.
--
-- The A1 spec's §5 bottom line calls this "reversible in five statements,
-- recorded as a comment in the migration header (not executable ...)" and
-- explicitly says that claim had never been run, only asserted. This is
-- that run. Note for the record: the literal comment block contains SIX
-- semicolon-terminated statements (two DROP TRIGGER, two DROP FUNCTION, one
-- multi-column ALTER TABLE, one DROP TABLE), not five -- the doc's count is
-- off by one. The substance of the claim (additive, cleanly reversible) is
-- what this file verifies, and it holds; the discrepancy is reported
-- alongside this contract's result, not silently corrected here.

DO $$
DECLARE
  v_count bigint;
BEGIN
  -- The four owner columns are gone.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'explore_events'
       AND column_name IN ('owner_type', 'owner_user_id', 'owner_community_id', 'owner_id')
  ) THEN
    RAISE EXCEPTION 'A1 rollback: an owner_* column survived the reversal';
  END IF;

  -- Both triggers and both functions are gone.
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.explore_events'::regclass
       AND tgname IN ('event_owner_derive', 'event_owner_change')
  ) THEN
    RAISE EXCEPTION 'A1 rollback: an owner trigger survived the reversal';
  END IF;
  IF to_regprocedure('public.tg_event_owner_derive()') IS NOT NULL
     OR to_regprocedure('public.tg_event_owner_change()') IS NOT NULL THEN
    RAISE EXCEPTION 'A1 rollback: a trigger function survived the reversal';
  END IF;

  -- The audit table is gone.
  IF to_regclass('public.event_owner_changes') IS NOT NULL THEN
    RAISE EXCEPTION 'A1 rollback: event_owner_changes survived the reversal';
  END IF;

  -- The table itself, and every base row, survives untouched: the legacy
  -- pair (host_user_id / community_id) is exactly what A1 never modified,
  -- so it is exactly what a reversal must leave alone. 13 = 9 fixture rows
  -- + 4 rows inserted by 171's insert-derivation cases; the earlier delete
  -- of Community B (T9) and of user 3 (R7) removed no explore_events row,
  -- only SET NULL'd a foreign key, so the count is unaffected by rollback.
  SELECT count(*) INTO v_count FROM public.explore_events;
  IF v_count <> 13 THEN
    RAISE EXCEPTION 'A1 rollback: expected 13 explore_events rows to survive untouched, found %', v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.explore_events
     WHERE id = '50000000-0000-0000-0000-000000000001' AND host_user_id = '00000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'A1 rollback: host_user_id attribution was lost on a row the migration never touched';
  END IF;

  -- The table is still a normal, writable table post-rollback (proves this
  -- is a real reversal, not a lock or a still-broken intermediate state).
  UPDATE public.explore_events SET title = 'post-rollback write still works' WHERE id = '50000000-0000-0000-0000-000000000003';
END $$;

SELECT 'PASS: A1''s stated header-comment reversal was extracted verbatim, executed for real, and cleanly restores explore_events to its pre-migration shape' AS result;
