-- Circle-aware plans. Hotfix (applied to prod 2026-06-09 as
-- circle_aware_plans_2b_join_role_cast_fix, immediately after the 4 main
-- migrations during live sim verification).
--
-- Bug: join_circle_plan_atomic's re-join UPDATE assigned a CASE that returns
-- TEXT ('host'/'guest') into event_members.role, which is the member_role ENUM
-- (introduced by the audit fix that preserves the creator's 'host' role). The
-- statement type-errors (42804) on every call, even with 0 matching rows, so
-- the gated RPC was broken. The original #2 self-test only EXISTENCE-checked
-- the function, never invoked it, so it slipped through.
--
-- Fix: cast the CASE arms to member_role. The fix is already folded into the
-- corrected 20260609140100 source; this file mirrors the prod hotfix for the
-- audit trail and re-applies idempotently.
--
-- The self-test now actually INVOKES join_circle_plan_atomic (insert path + the
-- re-join UPDATE path that had the bug) in a rolled-back sub-block.

BEGIN;

CREATE OR REPLACE FUNCTION public.join_circle_plan_atomic(
  p_event_id      uuid,
  p_user_id       uuid,
  p_age_at_join   integer DEFAULT NULL,
  p_gender_at_join text   DEFAULT NULL
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_event      RECORD;
  v_is_member  boolean;
  v_strangers  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'can only join as yourself';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF v_event.circle_id IS NULL THEN
    RETURN 'not_circle_plan';
  END IF;

  v_is_member := public.is_circle_member(v_event.circle_id, p_user_id);

  IF NOT v_is_member AND v_event.circle_visibility = 'circle_only' THEN
    RETURN 'not_eligible';
  END IF;

  IF NOT v_is_member THEN
    SELECT count(*)::int INTO v_strangers
    FROM public.event_members em
    WHERE em.event_id = p_event_id
      AND em.status = 'joined'
      AND NOT public.is_circle_member(v_event.circle_id, em.user_id);

    IF v_strangers >= COALESCE(v_event.stranger_cap, 0) THEN
      RETURN 'full';
    END IF;
  END IF;

  UPDATE public.event_members
  SET status = 'joined',
      role = CASE WHEN role = 'host' THEN 'host'::member_role ELSE 'guest'::member_role END,
      age_at_join    = COALESCE(p_age_at_join, age_at_join),
      gender_at_join = COALESCE(p_gender_at_join, gender_at_join)
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.event_members (event_id, user_id, role, status, age_at_join, gender_at_join)
    VALUES (p_event_id, p_user_id, 'guest', 'joined', p_age_at_join, p_gender_at_join);
  END IF;

  RETURN 'joined';
END;
$$;

REVOKE ALL ON FUNCTION public.join_circle_plan_atomic(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_circle_plan_atomic(uuid, uuid, integer, text) TO authenticated;

DO $$
DECLARE
  v_eid uuid; v_cid uuid; v_member uuid; v_res text;
BEGIN
  SELECT e.id, e.circle_id INTO v_eid, v_cid
  FROM public.events e WHERE e.circle_id IS NOT NULL AND e.circle_visibility='open' LIMIT 1;
  IF v_eid IS NULL THEN
    RAISE NOTICE 'no open circle plan to smoke-test join; skipping';
    RETURN;
  END IF;
  SELECT user_id INTO v_member FROM public.circle_members
    WHERE circle_id = v_cid AND status='joined' LIMIT 1;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member)::text, true);
    v_res := public.join_circle_plan_atomic(v_eid, v_member, 30, 'man');
    IF v_res <> 'joined' THEN
      RAISE EXCEPTION 'member join smoke-test expected joined, got %', v_res;
    END IF;
    v_res := public.join_circle_plan_atomic(v_eid, v_member, 31, 'man');
    IF v_res <> 'joined' THEN
      RAISE EXCEPTION 'member re-join smoke-test expected joined, got %', v_res;
    END IF;
    RAISE EXCEPTION 'ROLLBACK_SELFTEST_OK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ROLLBACK_SELFTEST_OK' THEN RAISE; END IF;
  END;
END $$;

COMMIT;
