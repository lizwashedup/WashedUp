\set ON_ERROR_STOP on

-- 1. Direct predicate checks. No auth.uid() dependency (the function takes
-- an explicit parameter), so this isolates the single source-of-truth
-- function from the trigger/DELETE mechanics tested below.
DO $$
BEGIN
  IF public.organizer_has_pending_payout('00000000-0000-0000-0000-000000000001') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'contract failed: blocked_organizer (pending) should have a pending payout';
  END IF;
  IF public.organizer_has_pending_payout('00000000-0000-0000-0000-000000000002') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'contract failed: paid_organizer (released) should not have a pending payout';
  END IF;
  IF public.organizer_has_pending_payout('00000000-0000-0000-0000-000000000003') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'contract failed: never_organizer (no rows) should not have a pending payout';
  END IF;
  IF public.organizer_has_pending_payout('00000000-0000-0000-0000-000000000004') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'contract failed: zero_amount_organizer ($0 pending row) should not have a pending payout';
  END IF;
  IF public.organizer_has_pending_payout('00000000-0000-0000-0000-000000000006') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'contract failed: failed_organizer (status=failed, not merely pending) should still count as a pending payout';
  END IF;
  RAISE NOTICE 'ok: organizer_has_pending_payout matches all 5 statically-seeded fixture cases';
END $$;

-- 2. End-to-end: the actual DELETE FROM auth.users path, proving the
-- trigger itself is what blocks deletion (the real enforcement point every
-- deletion path funnels through), not just the predicate function in
-- isolation.
DO $$
BEGIN
  BEGIN
    DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'contract failed: deleting blocked_organizer should have been rejected but succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%pending payout%' THEN
        RAISE EXCEPTION 'contract failed: blocked_organizer delete was rejected for the wrong reason: %', SQLERRM;
      END IF;
      RAISE NOTICE 'ok: blocked_organizer delete correctly rejected: %', SQLERRM;
  END;

  BEGIN
    DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000006';
    RAISE EXCEPTION 'contract failed: deleting failed_organizer should have been rejected but succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%pending payout%' THEN
        RAISE EXCEPTION 'contract failed: failed_organizer delete was rejected for the wrong reason: %', SQLERRM;
      END IF;
      RAISE NOTICE 'ok: failed_organizer (status=failed) delete correctly rejected too, not just pending: %', SQLERRM;
  END;
END $$;

DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000002';
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000003';
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000004';

-- 3. State transition: a payout that starts pending (blocks deletion), then
-- gets marked released the same way a real payout settlement would (status,
-- stripe_payout_id, and released_at all set together), after which deletion
-- succeeds. Sections 1 and 2 above only exercise statically-seeded rows
-- (already-pending, already-released); this proves the predicate and
-- trigger react correctly to an UPDATE on the same row, not just to two
-- separately-seeded end states that happen to agree.
DO $$
BEGIN
  IF public.organizer_has_pending_payout('00000000-0000-0000-0000-000000000005') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'contract failed: transitioning_organizer should start with a pending payout';
  END IF;

  BEGIN
    DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'contract failed: deleting transitioning_organizer before release should have been rejected but succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%pending payout%' THEN
        RAISE EXCEPTION 'contract failed: transitioning_organizer delete was rejected for the wrong reason: %', SQLERRM;
      END IF;
  END;
END $$;

UPDATE public.ticket_payouts
  SET status = 'released', stripe_payout_id = 'po_transition_test', released_at = now()
  WHERE organizer_user_id = '00000000-0000-0000-0000-000000000005';

DO $$
BEGIN
  IF public.organizer_has_pending_payout('00000000-0000-0000-0000-000000000005') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'contract failed: transitioning_organizer should no longer have a pending payout once marked released';
  END IF;

  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000005';

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000005') THEN
    RAISE EXCEPTION 'contract failed: transitioning_organizer delete should have succeeded once the payout was marked released';
  END IF;

  RAISE NOTICE 'ok: transitioning_organizer blocked while pending, allowed once marked released';
END $$;

DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining FROM auth.users;
  IF remaining <> 2 THEN
    RAISE EXCEPTION 'contract failed: expected exactly 2 surviving users (blocked_organizer, failed_organizer), found %', remaining;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'contract failed: blocked_organizer row should still exist; the earlier rejected delete must have actually rolled back';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000006') THEN
    RAISE EXCEPTION 'contract failed: failed_organizer row should still exist; the earlier rejected delete must have actually rolled back';
  END IF;
END $$;

SELECT 'PASS payout block: organizer_has_pending_payout matches fixture, deletion trigger blocks the unsettled AND the failed-but-unpaid organizer' AS result;
