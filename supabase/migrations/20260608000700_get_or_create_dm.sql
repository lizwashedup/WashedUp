-- DMs as 2-person circles. get_or_create_dm(p_other): the single entry point a
-- "Message {person}" button calls.
--
-- REVIEW ONLY. Not applied by the agent. Before applying to prod:
--   * Supabase preview branches are broken for this repo; apply directly,
--     transactionally, and rely on the trailing self-test to roll back.
--   * Reconcile against prod first. Depends on objects already live on prod:
--       - public.circles / public.circle_members (20260530220000)
--       - public.yours_is_blocked_between(uuid,uuid) (20260517000100)
--   * Additive only: one new SECURITY DEFINER function. No schema change. A DM
--     is modeled as an UNNAMED (name = '') 2-person circle on the existing
--     circle machinery (the schema's 13-16 note anticipated exactly this), so
--     no is_dm column is needed: name = '' is the marker, and create_circle
--     already rejects empty names so a real circle can never collide.
--
-- Idempotent: CREATE OR REPLACE. Wrapped BEGIN/COMMIT with a final self-test
-- that SMOKE-CALLS the function (plpgsql defers planning of embedded SQL to the
-- first call, so an existence-only check would miss a bad query) and rolls the
-- test rows back via a subtransaction so prod is never polluted. RAISE on any
-- real failure forces the whole migration to roll back.

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
-- Self-test: assert existence + SECURITY DEFINER, then SMOKE-CALL the body
-- (create + dedupe) under an impersonated caller and roll those rows back.
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

  -- Two distinct, mutually-unblocked real profiles to drive the smoke-call.
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
      -- Second call must return the SAME circle (idempotent / no duplicate DM).
      v_dm2 := public.get_or_create_dm(v_b);
      IF v_dm2 IS DISTINCT FROM v_dm THEN
        RAISE EXCEPTION 'get_or_create_dm not idempotent (% vs %)', v_dm, v_dm2;
      END IF;
      -- Success: force a subtransaction rollback so the test DM never persists.
      RAISE EXCEPTION 'GET_OR_CREATE_DM_SMOKE_OK';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM <> 'GET_OR_CREATE_DM_SMOKE_OK' THEN
          RAISE;  -- a real failure rolls back the entire migration
        END IF;
        -- sentinel caught: smoke-call passed, its rows are rolled back
    END;
  END IF;

  -- Defensive: set_config(..., is_local := true) lives to end-of-transaction,
  -- not end-of-DO-block, so clear the impersonation GUC here in case any future
  -- statement is appended before COMMIT (it must never inherit the test caller).
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

COMMIT;
