\set ON_ERROR_STOP on

-- Run after 52_circle_trust_fixture.sql and the R04 forward migration.

DO $$
DECLARE
  v_circle uuid;
  v_added integer;
  v_before integer;
  v_after integer;
  v_inviter uuid;
  v_role public.circle_role;
  v_join_result text;
BEGIN
  -- A creates a Circle with accepted, unblocked person B.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  v_circle := public.create_circle(
    'contract circle',
    NULL,
    ARRAY['00000000-0000-0000-0000-000000000002'::uuid]
  );

  IF v_circle IS NULL THEN
    RAISE EXCEPTION 'R04 contract failed: trusted initial Circle was not created';
  END IF;

  SELECT invited_by_user_id, role
  INTO v_inviter, v_role
  FROM public.circle_members
  WHERE circle_id = v_circle
    AND user_id = '00000000-0000-0000-0000-000000000002';

  IF v_inviter IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
     OR v_role <> 'member' THEN
    RAISE EXCEPTION 'R04 contract failed: initial trust attribution or role is wrong';
  END IF;

  -- Accepted but blocked C cannot be seeded into a new Circle. The whole call
  -- must roll back rather than leave a partial Circle.
  SELECT count(*) INTO v_before FROM public.circles;
  BEGIN
    PERFORM public.create_circle(
      'blocked seed',
      NULL,
      ARRAY['00000000-0000-0000-0000-000000000003'::uuid]
    );
    RAISE EXCEPTION 'R04 contract failed: blocked accepted person was seeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  SELECT count(*) INTO v_after FROM public.circles;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'R04 contract failed: rejected create left a partial Circle';
  END IF;

  -- B is a plain current member and may vouch for their accepted person D.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  v_added := public.invite_to_circle(
    v_circle,
    ARRAY['00000000-0000-0000-0000-000000000004'::uuid]
  );
  IF v_added <> 1 THEN
    RAISE EXCEPTION 'R04 contract failed: member vouch added % rows, expected 1', v_added;
  END IF;

  SELECT invited_by_user_id, role
  INTO v_inviter, v_role
  FROM public.circle_members
  WHERE circle_id = v_circle
    AND user_id = '00000000-0000-0000-0000-000000000004';

  IF v_inviter IS DISTINCT FROM '00000000-0000-0000-0000-000000000002'::uuid
     OR v_role <> 'member' THEN
    RAISE EXCEPTION 'R04 contract failed: member vouch attribution or role is wrong';
  END IF;

  -- A has no accepted relationship with E and cannot add E.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  BEGIN
    PERFORM public.invite_to_circle(
      v_circle,
      ARRAY['00000000-0000-0000-0000-000000000005'::uuid]
    );
    RAISE EXCEPTION 'R04 contract failed: disconnected target was added';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.circle_members
    WHERE circle_id = v_circle
      AND user_id = '00000000-0000-0000-0000-000000000005'
  ) THEN
    RAISE EXCEPTION 'R04 contract failed: denied disconnected target has a roster row';
  END IF;

  -- C knows E, but C is not a current member and therefore cannot vouch.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  BEGIN
    PERFORM public.invite_to_circle(
      v_circle,
      ARRAY['00000000-0000-0000-0000-000000000005'::uuid]
    );
    RAISE EXCEPTION 'R04 contract failed: nonmember vouched into a Circle';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- E cannot discover a Circle UUID and self-join it.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
  BEGIN
    PERFORM public.join_circle_atomic(v_circle);
    RAISE EXCEPTION 'R04 contract failed: outsider self-joined by UUID';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Existing joined members retain the old idempotent result.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  v_join_result := public.join_circle_atomic(v_circle);
  IF v_join_result <> 'joined' THEN
    RAISE EXCEPTION 'R04 contract failed: current member idempotent join returned %', v_join_result;
  END IF;

  -- Exactly the successful B-to-D vouch emits a system join row. Initial seeds
  -- remain quiet and denied calls emit nothing.
  SELECT count(*) INTO v_after
  FROM public.messages
  WHERE circle_id = v_circle AND message_type = 'system';
  IF v_after <> 1 THEN
    RAISE EXCEPTION 'R04 contract failed: expected 1 system row, got %', v_after;
  END IF;
END $$;

-- RLS probe under the actual authenticated role. E is still an outsider and
-- must not see the Circle or roster.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
SET ROLE authenticated;
DO $$
DECLARE
  v_visible integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.circles)
    + (SELECT count(*) FROM public.circle_members)
  INTO v_visible;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'R04 contract failed: outsider can read % protected rows', v_visible;
  END IF;
END $$;
RESET ROLE;

SELECT 'PASS R04: current-member vouch plus accepted relationship controls Circle entry' AS result;
