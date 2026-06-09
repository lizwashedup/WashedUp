-- get_or_create_dm: serialize the find-or-create so two concurrent "Message"
-- taps (the two people at once, or a fast double-tap beating the round-trip)
-- can't both miss the existing-DM lookup and each INSERT a separate DM circle
-- for the same pair (which would strand messages across two threads).
--
-- REVIEW ONLY. Not applied by the agent. Same protocol as 20260608000700:
--   * Apply directly + transactionally; the trailing self-test rolls back.
--   * CREATE OR REPLACE of the already-live function: adds ONE line
--     (pg_advisory_xact_lock on the sorted member pair) before the SELECT.
--     Everything else is byte-identical to 20260608000700. Additive/idempotent.
--   * The lock key is order-independent (sorted uuids), so both callers in a
--     race take the SAME transaction-scoped lock; the first creates the DM, the
--     second then finds it. No schema change, no new object.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_or_create_dm(p_other uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_circle uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_other IS NULL OR p_other = v_me THEN
    RAISE EXCEPTION 'invalid DM target';
  END IF;
  -- A DM only opens if neither of you has blocked the other (mirrors the
  -- accept-people-request block guard; defense in depth alongside the client).
  IF public.yours_is_blocked_between(v_me, p_other) THEN
    RAISE EXCEPTION 'blocked';
  END IF;

  -- Serialize per unordered pair: concurrent callers for the same two people
  -- block here until the first transaction commits, so the second sees the DM
  -- the first created instead of racing to insert a duplicate. Transaction
  -- scoped (auto-released at COMMIT/ROLLBACK).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      least(v_me::text, p_other::text) || '|' || greatest(v_me::text, p_other::text),
      0
    )
  );

  -- Reuse the existing DM for this exact pair if it's still just the two of you.
  -- A DM that was grown into a circle (a 3rd person) has 3+ joined members, so
  -- it no longer matches here and a fresh 1:1 DM is created instead.
  SELECT c.id INTO v_circle
  FROM public.circles c
  WHERE c.name = ''
    AND (SELECT count(*) FROM public.circle_members m
         WHERE m.circle_id = c.id AND m.status = 'joined') = 2
    AND EXISTS (SELECT 1 FROM public.circle_members m
                WHERE m.circle_id = c.id AND m.user_id = v_me AND m.status = 'joined')
    AND EXISTS (SELECT 1 FROM public.circle_members m
                WHERE m.circle_id = c.id AND m.user_id = p_other AND m.status = 'joined')
  ORDER BY c.created_at
  LIMIT 1;

  IF v_circle IS NOT NULL THEN
    RETURN v_circle;
  END IF;

  -- Create the DM: an unnamed circle. BOTH people are admins so either side can
  -- later grow it into a circle (invite_to_circle is admin-gated).
  INSERT INTO public.circles (name, description, creator_user_id)
  VALUES ('', NULL, v_me)
  RETURNING id INTO v_circle;

  INSERT INTO public.circle_members (circle_id, user_id, role, status)
  VALUES (v_circle, v_me,    'admin', 'joined'),
         (v_circle, p_other, 'admin', 'joined');

  RETURN v_circle;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: existence + SECURITY DEFINER, then SMOKE-CALL (create + dedupe)
-- under an impersonated caller and roll those rows back via a subtransaction.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_a uuid; v_b uuid; v_dm uuid; v_dm2 uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_or_create_dm' AND prosecdef
  ) THEN
    RAISE EXCEPTION 'get_or_create_dm must exist and be SECURITY DEFINER';
  END IF;

  SELECT id INTO v_a FROM public.profiles ORDER BY id LIMIT 1;
  SELECT id INTO v_b FROM public.profiles
    WHERE id <> v_a AND NOT public.yours_is_blocked_between(v_a, id)
    ORDER BY id LIMIT 1;

  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE NOTICE 'get_or_create_dm: smoke-call skipped (need two unblocked profiles)';
  ELSE
    BEGIN
      PERFORM set_config('request.jwt.claims',
                         json_build_object('sub', v_a::text)::text, true);
      v_dm := public.get_or_create_dm(v_b);
      IF v_dm IS NULL THEN
        RAISE EXCEPTION 'get_or_create_dm returned null';
      END IF;
      v_dm2 := public.get_or_create_dm(v_b);
      IF v_dm2 IS DISTINCT FROM v_dm THEN
        RAISE EXCEPTION 'get_or_create_dm not idempotent (% vs %)', v_dm, v_dm2;
      END IF;
      RAISE EXCEPTION 'GET_OR_CREATE_DM_SMOKE_OK';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM <> 'GET_OR_CREATE_DM_SMOKE_OK' THEN
          RAISE;
        END IF;
    END;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

COMMIT;
